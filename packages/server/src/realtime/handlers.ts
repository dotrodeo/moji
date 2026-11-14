/**
 * Wires Socket.IO events to RoomManager/Room commands. Every command validates
 * server-side and replies through an ack so the client gets deterministic
 * success/failure (e.g. a clue rejected for containing a letter emoji).
 *
 * This is the trust boundary: whatever arrives here was sent by an arbitrary
 * client, not necessarily ours. The TypeScript event types describe what our
 * client sends; at runtime any argument can be missing or of any type. In
 * particular the ack is just "whatever was in the last argument slot". Socket.IO
 * runs these listeners outside any try/catch of its own, so one throw that
 * escapes a handler is an uncaught exception, and before `handle` existed one
 * ack-less emit took the whole process (and every live room) down.
 */
import type { Server, Socket } from 'socket.io';
import type {
  AckResult,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@moji/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { Room } from '../rooms/Room.js';
import { RateLimiter } from './rateLimit.js';
import {
  parseChat,
  parseClue,
  parseConfigure,
  parseGuess,
  parseJoin,
  parseReady,
} from './validate.js';

/** Joins of any kind per client per minute: generous for a party, too slow to walk 24M codes. */
const JOINS_PER_MINUTE = 30;
/** New rooms (party or solo) per client per 10 minutes. */
const ROOM_CREATES_PER_10_MIN = 10;

/**
 * Who a socket is, for rate limiting. Production sits behind a Cloudflare
 * Tunnel and the port is bound to 127.0.0.1, so every connection arrives from
 * cloudflared and `cf-connecting-ip` is set by Cloudflare, not the client.
 * Without the header (local dev) the socket's own address is used.
 *
 * If production ever lost the header, every visitor would share cloudflared's
 * one address and the limits would apply to the whole site at once, so the
 * source in use is logged once per process (never the address itself).
 */
let loggedKeySource: string | null = null;
function clientKey(socket: AppSocket): string {
  const header = socket.handshake.headers['cf-connecting-ip'];
  const ip = Array.isArray(header) ? header[0] : header;
  const source = ip ? 'cf-connecting-ip' : 'socket address';
  if (loggedKeySource !== source) {
    loggedKeySource = source;
    console.log(`[socket] rate limits keyed by ${source}`);
  }
  return ip || socket.handshake.address || 'unknown';
}

type Io = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type Reply<T> = (result: AckResult<T>) => void;

/**
 * A reply function that can never throw: a missing or non-function ack becomes
 * a no-op, and an ack that throws is logged rather than allowed to escape.
 */
export function replyVia<T>(ack: unknown): Reply<T> {
  if (typeof ack !== 'function') return () => {};
  return (result) => {
    try {
      (ack as Reply<T>)(result);
    } catch (err) {
      console.error('[socket] ack callback threw', err);
    }
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

/**
 * Run a command and answer through the ack. Nothing thrown by `run` (including
 * a TypeError from a malformed payload) escapes. `after` runs only on success,
 * after the reply, and is guarded the same way.
 */
function handle<T>(ack: unknown, run: () => T, after?: () => void): void {
  const reply = replyVia<T>(ack);
  let data: T;
  try {
    data = run();
  } catch (err) {
    reply({ ok: false, error: errorMessage(err) });
    return;
  }
  reply({ ok: true, data });
  if (!after) return;
  try {
    after();
  } catch (err) {
    console.error('[socket] post-reply step failed', err);
  }
}

export function registerSocketHandlers(io: Io, manager: RoomManager): void {
  const joinLimiter = new RateLimiter(JOINS_PER_MINUTE, 60_000);
  const createLimiter = new RateLimiter(ROOM_CREATES_PER_10_MIN, 10 * 60_000);

  /** Stop receiving a room's broadcasts (hints, guess feed) once you're no longer in it. */
  const leaveChannel = (socket: AppSocket) => {
    if (socket.data.roomCode) socket.leave(manager.socketRoomName(socket.data.roomCode));
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
  };

  io.on('connection', (socket: AppSocket) => {
    socket.on('room:join', (payload, ack) => {
      let joined: Room | undefined;
      handle(
        ack,
        () => {
          const request = parseJoin(payload);
          const who = clientKey(socket);
          if (!joinLimiter.allow(who)) throw new Error('Too many attempts. Wait a minute and try again.');
          if (!request.code && !createLimiter.allow(who)) {
            throw new Error("You've started a lot of games. Wait a few minutes and try again.");
          }
          const { room, playerId, sessionToken } = manager.join(socket.id, request);
          if (socket.data.roomCode !== room.code) leaveChannel(socket);
          socket.data.playerId = playerId;
          socket.data.roomCode = room.code;
          socket.join(manager.socketRoomName(room.code));
          joined = room;
          return { code: room.code, playerId, sessionToken };
        },
        // Push an authoritative snapshot now that the socket is bound + joined.
        () => {
          if (joined) manager.onStateChange(joined);
        },
      );
    });

    socket.on('room:configure', (payload, ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.configure(pid, parseConfigure(payload)))),
    );

    socket.on('player:ready', (ready, ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.setReady(pid, parseReady(ready)))),
    );

    socket.on('game:start', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.start(pid))),
    );

    socket.on('clue:reshuffle', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.reshufflePrompt(pid))),
    );

    socket.on('clue:submit', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.submitClue(pid, parseClue(payload).emojis)),
      ),
    );

    socket.on('guess:submit', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.submitGuess(pid, parseGuess(payload).text)),
      ),
    );

    socket.on('clue:bump', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.bumpClue(pid))),
    );

    socket.on('clue:chat', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.sendClueChat(pid, parseChat(payload).text)),
      ),
    );

    socket.on('host:skip', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.hostSkip(pid))),
    );

    socket.on('host:next', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.hostNext(pid))),
    );

    socket.on('room:leave', (ack) =>
      handle(ack, () => {
        manager.leave(socket.id);
        leaveChannel(socket);
      }),
    );

    socket.on('disconnect', () => {
      try {
        manager.handleDisconnect(socket.id);
      } catch (err) {
        console.error('[socket] disconnect cleanup failed', err);
      }
    });
  });
}
