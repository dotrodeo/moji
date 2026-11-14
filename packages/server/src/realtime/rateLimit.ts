/**
 * A fixed-size sliding-window limiter: at most `limit` hits per key within
 * `windowMs`. In-memory, like room state, so it resets on restart — fine for
 * a single process whose only job here is to stop one client scripting the
 * creation of thousands of rooms or walking the room-code space.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Record a hit for `key`; false when that key is over its limit. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return true;
  }

  /** Drop keys with no hits left in the window, so the map can't grow forever. */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }

  size(): number {
    return this.hits.size;
  }
}
