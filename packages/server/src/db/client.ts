import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Shared Postgres connection + Drizzle instance. Postgres is used only for
 * durable data (content, completed games, analytics), never in the realtime
 * hot path.
 */
// connect_timeout: postgres.js waits 30 s by default, and /api/stats awaits
// this on the landing page. When the database is down, fail fast instead.
const queryClient = postgres(env.databaseUrl, { max: 10, connect_timeout: 5 });

export const db = drizzle(queryClient, { schema });
export { schema };
export type Db = typeof db;
