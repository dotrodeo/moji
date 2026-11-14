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
  io.on('connection', (socket: AppSocket) => {
    socket.on('room:join', (payload, ack) => {
      let joined: Room | undefined;
      handle(
        ack,
        () => {
          const { room, playerId, sessionToken } = manager.join(socket.id, payload);
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
      handle(ack, () => manager.command(socket.id, (room, pid) => room.configure(pid, payload))),
    );

    socket.on('player:ready', (ready, ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.setReady(pid, ready))),
    );

    socket.on('game:start', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.start(pid))),
    );

    socket.on('clue:reshuffle', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.reshufflePrompt(pid))),
    );

    socket.on('clue:submit', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.submitClue(pid, payload.emojis)),
      ),
    );

    socket.on('guess:submit', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.submitGuess(pid, payload.text)),
      ),
    );

    socket.on('clue:bump', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.bumpClue(pid))),
    );

    socket.on('clue:chat', (payload, ack) =>
      handle(ack, () =>
        manager.command(socket.id, (room, pid) => room.sendClueChat(pid, payload.text)),
      ),
    );

    socket.on('host:skip', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.hostSkip(pid))),
    );

    socket.on('host:next', (ack) =>
      handle(ack, () => manager.command(socket.id, (room, pid) => room.hostNext(pid))),
    );

    socket.on('room:leave', (ack) => handle(ack, () => manager.leave(socket.id)));

    socket.on('disconnect', () => {
      try {
        manager.handleDisconnect(socket.id);
      } catch (err) {
        console.error('[socket] disconnect cleanup failed', err);
      }
    });
  });
}
