import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  it('allows up to the limit within the window, per key', () => {
    const rl = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow('a', 0))).toEqual([true, true, true, false]);
    expect(rl.allow('b', 0)).toBe(true);
  });

  it('allows again once old hits leave the window', () => {
    const rl = new RateLimiter(2, 1000);
    rl.allow('a', 0);
    rl.allow('a', 500);
    expect(rl.allow('a', 900)).toBe(false);
    expect(rl.allow('a', 1001)).toBe(true); // the hit at 0 has expired
  });

  it('prunes keys with nothing left in the window', () => {
    const rl = new RateLimiter(1, 1000, 2);
    rl.allow('a', 0);
    rl.allow('b', 0);
    rl.allow('c', 5000); // over maxKeys: a and b are stale and go
    expect(rl.size()).toBe(1);
  });
});
