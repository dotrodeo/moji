/**
 * Owns the room lifecycle and the socket<->player binding, and fans authoritative
 * state out to clients via the Broadcaster using the role-filtered serializer.
 *
 * This is the integration point for the seams: RoomStore (where state lives),
 * Broadcaster (how messages ship), ContentProvider (prompt dealing). Swapping
 * any of them for a scaled-out implementation does not touch game logic.
 */
import {
  DEFAULT_AVATAR,
  DEFAULT_SCORING,
  SOLO_ROOM_CONFIG,
  type ChatMessage,
  type JoinRoomPayload,
  type PublicGuess,
} from '@moji/shared';
import { BotDriver } from '../bots/BotDriver.js';
import type { Broadcaster } from '../realtime/Broadcaster.js';
import { serializeRoomFor } from '../realtime/serialize.js';
import { issueSessionToken, verifySessionToken } from '../auth/session.js';
import { generateRoomCode } from '../game/codes.js';
import type { ContentProvider } from '../content/ContentProvider.js';
import { Room, type RoomHooks } from './Room.js';
import type { RoomStore } from './RoomStore.js';

const DISCONNECT_GRACE_MS = 60_000;
/**
 * Live rooms this process will hold. Rooms are cheap, but each one is memory and
 * timers in the one process every player shares; past this, new games are refused
 * rather than risking everyone's.
 */
export const MAX_ROOMS = 300;
/** A room with no player action for this long is closed by sweepIdleRooms(). */
export const IDLE_ROOM_MS = 60 * 60_000;

/** The solo opponent. Named and avatared so the room reads as two players. */
const BOT_NAME = 'Mojibot';
const BOT_AVATAR = '🤖';

export interface JoinOutcome {
  room: Room;
  playerId: string;
  sessionToken: string;
}

export class RoomManager implements RoomHooks {
  private playerToSocket = new Map<string, string>();
  private socketToPlayer = new Map<string, { roomCode: string; playerId: string }>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private persistedGames = new Set<string>();
  /** playerId -> the driver for that bot, so state pushes can reach it. */
  private bots = new Map<string, { roomCode: string; driver: BotDriver }>();

  constructor(
    private readonly store: RoomStore,
    private readonly broadcaster: Broadcaster,
    private readonly content: ContentProvider,
    private readonly persistGame: (room: Room) => Promise<void>,
  ) {}

  private newRoom(code: string): Room {
    return new Room(code, {
      content: this.content,
      scoring: DEFAULT_SCORING,
      rng: Math.random,
      hooks: this,
    });
  }

  /**
   * `payload` must already be validated (realtime/validate.ts). If this socket
   * was bound to a player, that player leaves their room, but only once the
   * new join has succeeded: a failed join changes nothing. Re-entering the same
   * slot with its token is a resume, not a leave.
   */
  join(socketId: string, payload: JoinRoomPayload): JoinOutcome {
    const prior = this.socketToPlayer.get(socketId);
    const outcome = this.resolveJoin(payload);
    if (prior && prior.playerId !== outcome.playerId) this.leaveBinding(prior);
    this.bind(socketId, outcome.room.code, outcome.playerId);
    return outcome;
  }

  private resolveJoin(payload: JoinRoomPayload): JoinOutcome {
    const displayName = sanitizeName(payload.displayName);
    const requestedCode = payload.code?.toUpperCase();

    // Reconnection: rebind ONLY when the player is explicitly re-entering the
    // SAME room their token is for (e.g. rejoin-by-code after a refresh). A
    // create (no code) or a different code must NOT resurrect the old room —
    // otherwise finishing a game and hitting "Create" drops you back into the
    // old room's final leaderboard.
    const token = verifySessionToken(payload.sessionToken);
    if (token && requestedCode && requestedCode === token.roomCode) {
      const room = this.store.get(token.roomCode);
      if (room && room.hasPlayer(token.playerId)) {
        this.cancelGrace(token.playerId);
        room.setConnection(token.playerId, 'CONNECTED');
        return {
          room,
          playerId: token.playerId,
          sessionToken: issueSessionToken(token.playerId, room.code),
        };
      }
    }

    // Solo: a fresh room with a bot in it, started on the spot. Deliberately
    // not reachable with a `code` — you cannot bring a bot into someone
    // else's game — and deliberately not a lobby, because there is nobody to
    // wait for and the mode exists to be playable in one click.
    if (payload.solo && !requestedCode) return this.createSoloRoom(displayName, payload);

    // Create or look up the room.
    let room: Room;
    if (requestedCode) {
      const found = this.store.get(requestedCode);
      if (!found) throw new Error('Room not found.');
      // The other direction of the rule above: nobody walks into a stranger's
      // solo game with its code (from a shared /r/ link, say).
      if (found.config.mode === 'solo') {
        throw new Error("That's a solo game. Start your own from the home page.");
      }
      room = found;
    } else {
      room = this.createRoom();
    }

    const role = payload.asSpectator ? 'spectator' : 'player';
    const player = room.addPlayer(displayName, role, payload.avatar || DEFAULT_AVATAR);
    return {
      room,
      playerId: player.id,
      sessionToken: issueSessionToken(player.id, room.code),
    };
  }

  private createRoom(): Room {
    if (this.store.count() >= MAX_ROOMS) {
      throw new Error('Moji is full right now. Try again in a few minutes.');
    }
    const code = generateRoomCode((c) => this.store.has(c));
    const room = this.newRoom(code);
    this.store.set(room);
    return room;
  }

  private createSoloRoom(displayName: string, payload: JoinRoomPayload): JoinOutcome {
    const room = this.createRoom();
    room.config = { ...SOLO_ROOM_CONFIG };

    // The human joins first, so they are the host and the bot never is.
    const human = room.addPlayer(displayName, 'player', payload.avatar || DEFAULT_AVATAR);
    const bot = room.addPlayer(BOT_NAME, 'player', BOT_AVATAR, true);
    this.spawnBot(room, bot.id);
    room.start(human.id);

    return { room, playerId: human.id, sessionToken: issueSessionToken(human.id, room.code) };
  }

  /**
   * Attach a driver to a bot player. The commands below are the same guarded
   * methods a socket handler calls — the bot has no private entrance to the
   * room, which is the point of it (see bots/BotDriver.ts).
   */
  private spawnBot(room: Room, botId: string): void {
    const driver = new BotDriver({
      commands: {
        submitClue: (emojis) => room.submitClue(botId, emojis),
        submitGuess: (text) => void room.submitGuess(botId, text),
        bump: () => room.bumpClue(botId),
        chat: (text) => room.sendClueChat(botId, text),
      },
    });
    this.bots.set(botId, { roomCode: room.code, driver });
  }

  command<T>(socketId: string, fn: (room: Room, playerId: string) => T): T {
    const binding = this.socketToPlayer.get(socketId);
    if (!binding) throw new Error('Join a room first.');
    const room = this.store.get(binding.roomCode);
    if (!room) throw new Error('Room no longer exists.');
    return fn(room, binding.playerId);
  }

  leave(socketId: string): void {
    const binding = this.socketToPlayer.get(socketId);
    if (!binding) return;
    const room = this.store.get(binding.roomCode);
    this.unbind(socketId);
    room?.removePlayer(binding.playerId);
  }

  /** A socket's previous player, when that socket joins somewhere else. */
  private leaveBinding(binding: { roomCode: string; playerId: string }): void {
    this.playerToSocket.delete(binding.playerId);
    this.cancelGrace(binding.playerId);
    this.store.get(binding.roomCode)?.removePlayer(binding.playerId);
  }

  /**
   * Close every room with no player action for IDLE_ROOM_MS. Abandoned lobbies
   * and finished games otherwise stay in memory for as long as a socket is
   * attached. Called on an interval from index.ts.
   */
  sweepIdleRooms(now = Date.now()): number {
    let closed = 0;
    for (const code of this.store.codes()) {
      const room = this.store.get(code);
      if (room && now - room.lastActivityAt > IDLE_ROOM_MS) {
        room.expire();
        closed++;
      }
    }
    return closed;
  }

  /** Socket dropped: keep the slot for a grace period, then remove. */
  handleDisconnect(socketId: string): void {
    const binding = this.socketToPlayer.get(socketId);
    if (!binding) return;
    const { roomCode, playerId } = binding;
    this.socketToPlayer.delete(socketId);
    if (this.playerToSocket.get(playerId) === socketId) this.playerToSocket.delete(playerId);

    const room = this.store.get(roomCode);
    if (!room) return;
    room.setConnection(playerId, 'DISCONNECTED');
    this.cancelGrace(playerId);
    this.graceTimers.set(
      playerId,
      setTimeout(() => {
        this.graceTimers.delete(playerId);
        const r = this.store.get(roomCode);
        // Only remove if they didn't reconnect to another socket meanwhile.
        if (r && !this.playerToSocket.has(playerId)) r.removePlayer(playerId);
      }, DISCONNECT_GRACE_MS),
    );
  }

  // ── RoomHooks ──────────────────────────────────────────────────────────────
  onStateChange(room: Room): void {
    const snap = room.getSnapshot();
    for (const player of snap.players) {
      if (player.isBot) {
        // The bot is handed the same role-filtered payload a browser gets, and
        // nothing else. Its driver only ever schedules work on a timer, so this
        // call cannot re-enter the room mid-mutation.
        this.bots.get(player.id)?.driver.onView(serializeRoomFor(snap, player.id));
        continue;
      }
      const socketId = this.playerToSocket.get(player.id);
      if (socketId) this.broadcaster.toSocket(socketId, 'room:state', serializeRoomFor(snap, player.id));
    }
    if (snap.phase === 'GAME_RESULTS' && !this.persistedGames.has(room.code)) {
      this.persistedGames.add(room.code);
      this.persistGame(room).catch((err) => console.error('[persist] game failed:', err));
    }
  }

  onGuess(room: Room, guess: PublicGuess): void {
    // Already public-safe (correct guesses are blanked in Room.submitGuess).
    this.broadcaster.toRoom(room.code, 'guess:new', guess);
  }

  onChat(room: Room, message: ChatMessage, recipientIds: string[]): void {
    // Per-socket, never toRoom(): the Room vetted this audience because the
    // text is unfiltered player writing that usually names the answer.
    for (const playerId of recipientIds) {
      const socketId = this.playerToSocket.get(playerId);
      if (socketId) this.broadcaster.toSocket(socketId, 'chat:new', message);
    }
  }

  onHint(room: Room, hint: string): void {
    // Public-safe: the mask is always short of the full answer.
    this.broadcaster.toRoom(room.code, 'clue:hint', hint);
  }

  onClosed(room: Room): void {
    this.persistedGames.delete(room.code);
    this.store.delete(room.code);
    // Forget every socket binding into this room, or they outlive it.
    for (const [socketId, binding] of this.socketToPlayer) {
      if (binding.roomCode !== room.code) continue;
      this.socketToPlayer.delete(socketId);
      if (this.playerToSocket.get(binding.playerId) === socketId) {
        this.playerToSocket.delete(binding.playerId);
      }
      this.cancelGrace(binding.playerId);
    }
    for (const [playerId, bot] of this.bots) {
      if (bot.roomCode !== room.code) continue;
      bot.driver.dispose(); // otherwise its timers outlive the room
      this.bots.delete(playerId);
    }
  }

  // ── binding helpers ──────────────────────────────────────────────────────
  private bind(socketId: string, roomCode: string, playerId: string): void {
    this.playerToSocket.set(playerId, socketId);
    this.socketToPlayer.set(socketId, { roomCode, playerId });
  }

  private unbind(socketId: string): void {
    const binding = this.socketToPlayer.get(socketId);
    if (binding && this.playerToSocket.get(binding.playerId) === socketId) {
      this.playerToSocket.delete(binding.playerId);
    }
    this.socketToPlayer.delete(socketId);
  }

  private cancelGrace(playerId: string): void {
    const t = this.graceTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(playerId);
    }
  }

  /** Socket.IO room name a socket should join for room-wide broadcasts. */
  socketRoomName(roomCode: string): string {
    return roomCode;
  }
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, 20);
  // TODO(moderation §8): run against moderation_blocklist (leetspeak-normalized).
  return trimmed || 'Player';
}
