import { describe, expect, it } from 'vitest';
import { IDLE_ROOM_MS, MAX_ROOMS, RoomManager } from './RoomManager.js';
import { MAX_PLAYERS, MAX_SPECTATORS } from './Room.js';
import { InMemoryRoomStore } from './RoomStore.js';
import type { Broadcaster } from '../realtime/Broadcaster.js';
import type { ContentProvider } from '../content/ContentProvider.js';

const noopBroadcaster = { toSocket() {}, toRoom() {} } as unknown as Broadcaster;
const fakeContent = { packs: () => [] } as unknown as ContentProvider;

const newManager = () =>
  new RoomManager(new InMemoryRoomStore(), noopBroadcaster, fakeContent, async () => {});

/** A manager plus its store, for tests that need to look inside. */
const withStore = () => {
  const store = new InMemoryRoomStore();
  return { store, mgr: new RoomManager(store, noopBroadcaster, fakeContent, async () => {}) };
};
const playerIds = (store: InMemoryRoomStore, code: string) =>
  store.get(code)?.getSnapshot().players.map((p) => p.id) ?? [];

describe('RoomManager: reconnection vs. create', () => {
  it('creating (no code) with a stale token starts a NEW room, not the old one', () => {
    const mgr = newManager();
    const first = mgr.join('sock1', { displayName: 'Alice' });
    // Same player returns holding their token but CREATES a new room (no code).
    const second = mgr.join('sock2', {
      displayName: 'Alice',
      sessionToken: first.sessionToken,
    });
    expect(second.room.code).not.toBe(first.room.code);
    expect(second.playerId).not.toBe(first.playerId);
  });

  it('re-entering the SAME code with a token reconnects to the same slot', () => {
    const mgr = newManager();
    const first = mgr.join('sock1', { displayName: 'Alice' });
    const rejoin = mgr.join('sock2', {
      displayName: 'Alice',
      code: first.room.code,
      sessionToken: first.sessionToken,
    });
    expect(rejoin.room.code).toBe(first.room.code);
    expect(rejoin.playerId).toBe(first.playerId); // same player slot resumed
  });

  it('joining a DIFFERENT code with a token joins as a new player', () => {
    const mgr = newManager();
    const a = mgr.join('s1', { displayName: 'Alice' });
    const bHost = mgr.join('s2', { displayName: 'Bob' });
    const aInB = mgr.join('s3', {
      displayName: 'Alice',
      code: bHost.room.code,
      sessionToken: a.sessionToken,
    });
    expect(aInB.room.code).toBe(bHost.room.code);
    expect(aInB.playerId).not.toBe(a.playerId);
  });
});

describe('RoomManager: one socket, one player', () => {
  it('joining elsewhere removes the socket\'s previous player', () => {
    const { store, mgr } = withStore();
    const host = mgr.join('host', { displayName: 'Host' });
    const guest = mgr.join('guest', { displayName: 'Guest', code: host.room.code });
    // Same socket creates a new room: the old seat must not linger as a ghost.
    mgr.join('guest', { displayName: 'Guest' });
    expect(playerIds(store, host.room.code)).toEqual([host.playerId]);
    expect(playerIds(store, host.room.code)).not.toContain(guest.playerId);
  });

  it('a failed join leaves the current seat alone', () => {
    const { store, mgr } = withStore();
    const a = mgr.join('s1', { displayName: 'Alice' });
    expect(() => mgr.join('s1', { displayName: 'Alice', code: 'ZZZZZ' })).toThrow('Room not found.');
    expect(playerIds(store, a.room.code)).toEqual([a.playerId]);
    expect(() => mgr.command('s1', () => 'still bound')).not.toThrow();
  });

  it('resuming your own seat on the same socket is not a leave', () => {
    const { store, mgr } = withStore();
    const a = mgr.join('s1', { displayName: 'Alice' });
    const again = mgr.join('s1', {
      displayName: 'Alice',
      code: a.room.code,
      sessionToken: a.sessionToken,
    });
    expect(again.playerId).toBe(a.playerId);
    expect(playerIds(store, a.room.code)).toEqual([a.playerId]);
  });
});

describe('RoomManager: limits', () => {
  it('refuses a code-join into a solo room', () => {
    const { store, mgr } = withStore();
    const host = mgr.join('s1', { displayName: 'Solo' });
    store.get(host.room.code)!.config.mode = 'solo';
    expect(() => mgr.join('s2', { displayName: 'Stranger', code: host.room.code })).toThrow(
      /solo game/,
    );
  });

  it('caps players and spectators per room', () => {
    const mgr = newManager();
    const host = mgr.join('s0', { displayName: 'Host' });
    const code = host.room.code;
    for (let i = 1; i < MAX_PLAYERS; i++) mgr.join(`p${i}`, { displayName: `P${i}`, code });
    expect(() => mgr.join('pX', { displayName: 'One too many', code })).toThrow('This room is full.');
    for (let i = 0; i < MAX_SPECTATORS; i++) {
      mgr.join(`w${i}`, { displayName: `W${i}`, code, asSpectator: true });
    }
    expect(() => mgr.join('wX', { displayName: 'Watcher', code, asSpectator: true })).toThrow(
      /spectators/,
    );
  });

  it('refuses new rooms past MAX_ROOMS', () => {
    const { store, mgr } = withStore();
    for (let i = 0; i < MAX_ROOMS; i++) mgr.join(`s${i}`, { displayName: 'P' });
    expect(store.count()).toBe(MAX_ROOMS);
    expect(() => mgr.join('one-more', { displayName: 'P' })).toThrow(/full right now/);
  });

  it('sweeps idle rooms and forgets their sockets', () => {
    const { store, mgr } = withStore();
    const a = mgr.join('s1', { displayName: 'Idle' });
    const b = mgr.join('s2', { displayName: 'Busy' });
    store.get(a.room.code)!.lastActivityAt = Date.now() - IDLE_ROOM_MS - 1;
    expect(mgr.sweepIdleRooms()).toBe(1);
    expect(store.has(a.room.code)).toBe(false);
    expect(store.has(b.room.code)).toBe(true);
    expect(() => mgr.command('s1', () => 0)).toThrow('Join a room first.');
  });
});

describe('RoomManager: reconnecting on a new socket', () => {
  const connectionOf = (store: InMemoryRoomStore, code: string, id: string) =>
    store.get(code)?.getSnapshot().players.find((p) => p.id === id)?.connection;

  it('a late disconnect from the replaced socket leaves the player connected', () => {
    const { store, mgr } = withStore();
    const first = mgr.join('old', { displayName: 'Alice' });
    mgr.join('new', { displayName: 'Alice', code: first.room.code, sessionToken: first.sessionToken });
    mgr.handleDisconnect('old'); // the old connection finally times out
    expect(connectionOf(store, first.room.code, first.playerId)).toBe('CONNECTED');
  });

  it('the replaced socket no longer acts for the player', () => {
    const { mgr } = withStore();
    const first = mgr.join('old', { displayName: 'Alice' });
    mgr.join('new', { displayName: 'Alice', code: first.room.code, sessionToken: first.sessionToken });
    expect(() => mgr.command('old', () => 0)).toThrow('Join a room first.');
    expect(() => mgr.command('new', () => 0)).not.toThrow();
  });

  it('a disconnect from the current socket still marks the player disconnected', () => {
    const { store, mgr } = withStore();
    const first = mgr.join('only', { displayName: 'Alice' });
    mgr.join('other', { displayName: 'Bob', code: first.room.code });
    mgr.handleDisconnect('only');
    expect(connectionOf(store, first.room.code, first.playerId)).toBe('DISCONNECTED');
  });
});

describe('RoomManager: saving games', () => {
  it('saves a rematch as well as the first game', () => {
    const saved: number[] = [];
    const mgr = new RoomManager(new InMemoryRoomStore(), noopBroadcaster, fakeContent, async (room) => {
      saved.push(room.getSnapshot().gameNumber);
    });
    const finished = (gameNumber: number) =>
      ({
        code: 'ABCDE',
        getSnapshot: () => ({ phase: 'GAME_RESULTS', gameNumber, players: [] }),
      }) as unknown as Parameters<RoomManager['onStateChange']>[0];
    mgr.onStateChange(finished(1));
    mgr.onStateChange(finished(1)); // the same results pushed again: saved once
    mgr.onStateChange(finished(2)); // the rematch
    expect(saved).toEqual([1, 2]);
  });
});

describe('RoomManager: one seat, newest tab wins', () => {
  const spyBroadcaster = () => {
    const sent: { socketId: string; event: string }[] = [];
    const b = {
      toSocket: (socketId: string, event: string) => sent.push({ socketId, event }),
      toRoom() {},
    } as unknown as Broadcaster;
    return { b, sent };
  };

  it('tells the replaced tab, and only that tab, that its seat moved', () => {
    const { b, sent } = spyBroadcaster();
    const mgr = new RoomManager(new InMemoryRoomStore(), b, fakeContent, async () => {});
    const first = mgr.join('tab1', { displayName: 'Alice' });
    mgr.join('tab2', { displayName: 'Alice', code: first.room.code, sessionToken: first.sessionToken });
    const replaced = sent.filter((s) => s.event === 'session:replaced');
    expect(replaced).toEqual([{ socketId: 'tab1', event: 'session:replaced' }]);
  });

  it('does not tell a socket it replaced itself when it resumes its own seat', () => {
    const { b, sent } = spyBroadcaster();
    const mgr = new RoomManager(new InMemoryRoomStore(), b, fakeContent, async () => {});
    const first = mgr.join('tab1', { displayName: 'Alice' });
    mgr.join('tab1', { displayName: 'Alice', code: first.room.code, sessionToken: first.sessionToken });
    expect(sent.filter((s) => s.event === 'session:replaced')).toEqual([]);
  });

  it('flags a returning player whose seat was given up as a new seat', () => {
    const mgr = newManager();
    const host = mgr.join('host', { displayName: 'Host' });
    const away = mgr.join('away', { displayName: 'Away', code: host.room.code });
    mgr.leave('away'); // what the grace timer does after 60 s away
    const back = mgr.join('back', {
      displayName: 'Away',
      code: host.room.code,
      sessionToken: away.sessionToken,
    });
    expect(back.newSeat).toBe(true);
    expect(back.playerId).not.toBe(away.playerId);
  });

  it('does not flag an ordinary resume or a first join as a new seat', () => {
    const mgr = newManager();
    const host = mgr.join('host', { displayName: 'Host' });
    expect(host.newSeat).toBeUndefined();
    const resumed = mgr.join('host2', {
      displayName: 'Host',
      code: host.room.code,
      sessionToken: host.sessionToken,
    });
    expect(resumed.newSeat).toBeUndefined();
  });
});
