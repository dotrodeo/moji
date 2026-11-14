import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from '@moji/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same-origin: dev proxies /socket.io to the server via Vite; prod serves both
// from one container. Override with VITE_SERVER_URL if you split them.
const url = import.meta.env.VITE_SERVER_URL || undefined;

export const socket: AppSocket = io(url, { autoConnect: true });

/**
 * How long a command waits for the server's answer. Socket.IO buffers emits
 * while disconnected, so without a deadline a button pressed during an outage
 * would stay busy forever.
 */
const ACK_TIMEOUT_MS = 10_000;

export const NO_ANSWER = "The server didn't answer. Check your connection and try again.";

/** Promise wrapper around an ack-based command. Rejects with the server's own message. */
export function emitAck<T = void>(
  event: keyof ClientToServerEvents,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, res: AckResult<T>) => {
      if (err) reject(new Error(NO_ANSWER));
      else if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    };
    // The event map types each command's arguments; this one helper sends all
    // of them, so it goes through the untyped emitter.
    const timed = socket.timeout(ACK_TIMEOUT_MS) as unknown as {
      emit(event: string, ...args: unknown[]): void;
    };
    if (payload === undefined) timed.emit(event, cb);
    else timed.emit(event, payload, cb);
  });
}
