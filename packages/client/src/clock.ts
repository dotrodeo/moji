/**
 * Server-corrected time. Every phase deadline (`deadlineTs`) is in the
 * server's clock, and a device's clock can be off by seconds or minutes: a
 * phone 30 s fast used to show 0:00 and "GO!" for the whole window. Each
 * room:state carries `serverNow`; countdowns read `serverNow()` instead of
 * `Date.now()`.
 *
 * The offset absorbs one-way latency too (the state is a few ms old on
 * arrival), which errs by a fraction of a second: invisible on a countdown.
 */
let offsetMs = 0;

/** Record the server's clock from a freshly received room:state. */
export function syncClock(serverNowMs: number): void {
  if (Number.isFinite(serverNowMs)) offsetMs = serverNowMs - Date.now();
}

/** The current time on the server's clock (epoch ms). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
