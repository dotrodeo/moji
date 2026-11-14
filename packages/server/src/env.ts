/** Centralized, validated environment access. */

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/** The fallback only exists so local dev works out of the box. */
export const DEFAULT_SESSION_SECRET = 'dev-insecure-secret-change-me';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000',
  sessionSecret: required('SESSION_SECRET', DEFAULT_SESSION_SECRET),
  databaseUrl: required('DATABASE_URL', 'postgres://moji:moji@localhost:5432/moji'),
  /** apply migrations + seed on boot (set AUTO_MIGRATE=false to manage externally) */
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
  /**
   * Log every wrong guess with its answer, as tuning data for the matcher. Off
   * unless asked for: it puts free text from strangers, next to the answers, in
   * the logs, and writes a line per miss.
   */
  logGuessMisses: process.env.LOG_GUESS_MISSES === 'true',
};

// Sessions are signed with this secret and player ids are visible to everyone
// in a room, so with the public default anyone could forge another player's
// token, rejoin as them and read their answer. Refuse to run that way.
if (env.isProd && env.sessionSecret === DEFAULT_SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set to a real secret in production.');
}
