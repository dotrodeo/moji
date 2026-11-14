import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses to start in production with the default session secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'dev-insecure-secret-change-me');
    vi.resetModules();
    await expect(import('./env.js')).rejects.toThrow(/real secret in production/);
  });

  it('starts in production with a real secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'a-real-secret-of-reasonable-length');
    vi.resetModules();
    const { env } = await import('./env.js');
    expect(env.isProd).toBe(true);
  });

  it('keeps guess-miss logging off unless asked for', async () => {
    vi.stubEnv('LOG_GUESS_MISSES', '');
    vi.resetModules();
    expect((await import('./env.js')).env.logGuessMisses).toBe(false);
    vi.stubEnv('LOG_GUESS_MISSES', 'true');
    vi.resetModules();
    expect((await import('./env.js')).env.logGuessMisses).toBe(true);
  });
});
