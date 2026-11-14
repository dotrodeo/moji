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
function connect() {
  const manager = new RoomManager(new InMemoryRoomStore(), noopBroadcaster, fakeContent, async () => {});
  const listeners = new Map<string, Listener>();
  const socket = {
    id: `sock-${Math.random().toString(36).slice(2)}`,
    data: {} as Record<string, unknown>,
    join: () => {},
    on: (event: string, fn: Listener) => listeners.set(event, fn),
  };
  const io = { on: (_event: string, fn: (s: typeof socket) => void) => fn(socket) };
  registerSocketHandlers(io as never, manager);
  const emit = (event: string, ...args: unknown[]) => {
    const fn = listeners.get(event);
    if (!fn) throw new Error(`no handler for ${event}`);
    fn(...args);
  };
  return { emit, events: [...listeners.keys()] };
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
