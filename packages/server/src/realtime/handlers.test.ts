import { describe, expect, it, vi } from 'vitest';
import { registerSocketHandlers, replyVia } from './handlers.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { InMemoryRoomStore } from '../rooms/RoomStore.js';
import type { Broadcaster } from './Broadcaster.js';
import type { ContentProvider } from '../content/ContentProvider.js';

const noopBroadcaster = { toSocket() {}, toRoom() {} } as unknown as Broadcaster;
const fakeContent = { packs: () => [] } as unknown as ContentProvider;

type Listener = (...args: unknown[]) => void;

/**
 * Just enough of Socket.IO to drive the handlers directly, with arguments a
 * real client library would never send but a hand-written one can.
 */
function connect(ip = `10.0.0.${Math.floor(Math.random() * 250)}`) {
  const store = new InMemoryRoomStore();
  const manager = new RoomManager(store, noopBroadcaster, fakeContent, async () => {});
  const listeners = new Map<string, Listener>();
  const socket = {
    id: `sock-${Math.random().toString(36).slice(2)}`,
    data: {} as Record<string, unknown>,
    handshake: { headers: { 'cf-connecting-ip': ip }, address: '127.0.0.1' },
    channels: new Set<string>(),
    join(room: string) {
      this.channels.add(room);
    },
    leave(room: string) {
      this.channels.delete(room);
    },
    on: (event: string, fn: Listener) => listeners.set(event, fn),
  };
  const io = { on: (_event: string, fn: (s: typeof socket) => void) => fn(socket) };
  registerSocketHandlers(io as never, manager);
  const emit = (event: string, ...args: unknown[]) => {
    const fn = listeners.get(event);
    if (!fn) throw new Error(`no handler for ${event}`);
    fn(...args);
  };
  return { emit, events: [...listeners.keys()], socket, manager, store };
}

const COMMANDS_WITHOUT_PAYLOAD = [
  'game:start',
  'clue:reshuffle',
  'clue:bump',
  'host:skip',
  'host:next',
  'room:leave',
];
const COMMANDS_WITH_PAYLOAD = [
  'room:join',
  'room:configure',
  'player:ready',
  'clue:submit',
  'guess:submit',
  'clue:chat',
];

describe('socket handlers survive hostile input', () => {
  it('registers every command this test covers', () => {
    const { events } = connect();
    for (const e of [...COMMANDS_WITHOUT_PAYLOAD, ...COMMANDS_WITH_PAYLOAD, 'disconnect']) {
      expect(events).toContain(e);
    }
  });

  it.each(COMMANDS_WITHOUT_PAYLOAD)('%s with no ack does not throw', (event) => {
    const { emit } = connect();
    expect(() => emit(event)).not.toThrow();
  });

  it.each(COMMANDS_WITHOUT_PAYLOAD)('%s with a non-function ack does not throw', (event) => {
    const { emit } = connect();
    expect(() => emit(event, 'not a function')).not.toThrow();
    expect(() => emit(event, { x: 1 })).not.toThrow();
  });

  it.each(COMMANDS_WITH_PAYLOAD)('%s with no payload and no ack does not throw', (event) => {
    const { emit } = connect();
    expect(() => emit(event)).not.toThrow();
  });

  it.each(COMMANDS_WITH_PAYLOAD)('%s with junk payloads always replies exactly once', (event) => {
    const { emit } = connect();
    for (const junk of [null, 42, 'str']) {
      const ack = vi.fn();
      expect(() => emit(event, junk, ack)).not.toThrow();
      // A reply, never silence: the client must always be able to settle.
      expect(ack).toHaveBeenCalledTimes(1);
    }
  });

  it('commands before joining fail through the ack, not by throwing', () => {
    const { emit } = connect();
    const ack = vi.fn();
    emit('game:start', ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'Join a room first.' });
  });

  it('an ack that throws does not escape the handler', () => {
    const { emit } = connect();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = () => {
      throw new Error('boom');
    };
    expect(() => emit('game:start', throwing)).not.toThrow();
    expect(() => emit('room:join', { displayName: 'Alice' }, throwing)).not.toThrow();
    spy.mockRestore();
  });

  it('disconnect for an unknown socket does not throw', () => {
    const { emit } = connect();
    expect(() => emit('disconnect')).not.toThrow();
  });

  it('still joins and replies normally for a well-formed client', () => {
    const { emit } = connect();
    const ack = vi.fn();
    emit('room:join', { displayName: 'Alice' }, ack);
    const reply = ack.mock.calls[0]?.[0];
    expect(reply.ok).toBe(true);
    expect(reply.data.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(typeof reply.data.sessionToken).toBe('string');
  });
});

describe('replyVia', () => {
  it('turns a missing or non-function ack into a no-op', () => {
    expect(() => replyVia(undefined)({ ok: true, data: undefined })).not.toThrow();
    expect(() => replyVia(7)({ ok: true, data: undefined })).not.toThrow();
  });
});

describe('socket handlers validate payloads at the boundary', () => {
  const join = (emit: (e: string, ...a: unknown[]) => void, payload: unknown) => {
    const ack = vi.fn();
    emit('room:join', payload, ack);
    return ack.mock.calls[0]?.[0];
  };

  it('rejects a join whose payload is not an object', () => {
    const { emit } = connect();
    expect(join(emit, 'x')).toEqual({ ok: false, error: 'Invalid request.' });
  });

  it('replaces an avatar outside the picker list with the default', () => {
    const { emit, store } = connect();
    const reply = join(emit, { displayName: 'Mallory', avatar: { not: 'a string' } });
    expect(reply.ok).toBe(true);
    const player = store.get(reply.data.code)?.getSnapshot().players[0];
    expect(player?.avatar).toBe('😎');
  });

  it('refuses an over-long guess before it reaches the room', () => {
    const { emit } = connect();
    join(emit, { displayName: 'Alice' });
    const ack = vi.fn();
    emit('guess:submit', { text: 'x'.repeat(1_000_000) }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'That guess is too long.' });
  });

  it('refuses non-numeric settings instead of storing NaN', () => {
    const { emit } = connect();
    join(emit, { displayName: 'Host' });
    const ack = vi.fn();
    emit('room:configure', { rounds: 'lots' }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'Invalid settings.' });
  });

  it('rate-limits room creation per client', () => {
    const { emit } = connect('203.0.113.7');
    const results = Array.from({ length: 12 }, () => join(emit, { displayName: 'Spammer' }).ok);
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.at(-1)).toBe(false);
  });

  it('leaves the old broadcast channel when a socket joins another room', () => {
    const { emit, socket } = connect();
    const first = join(emit, { displayName: 'Alice' });
    const second = join(emit, { displayName: 'Alice' });
    expect(socket.channels.has(second.data.code)).toBe(true);
    expect(socket.channels.has(first.data.code)).toBe(false);
  });

  it('leaves the broadcast channel on room:leave', () => {
    const { emit, socket } = connect();
    const first = join(emit, { displayName: 'Alice' });
    emit('room:leave', vi.fn());
    expect(socket.channels.has(first.data.code)).toBe(false);
  });
});
