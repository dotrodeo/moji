/**
 * Best-effort persistence of completed games (design doc §5). Live play never
 * touches Postgres; we write a durable record only when a game finishes. A DB
 * outage must not break gameplay, so callers treat this as fire-and-forget.
 */
import { db } from './db/client.js';
import { gamePlayers, games } from './db/schema.js';
import type { Room } from './rooms/Room.js';

export async function persistCompletedGame(room: Room): Promise<void> {
  const snap = room.getSnapshot();
  const results = snap.gameResults ?? [];

  // One transaction: a failure partway can't leave a counted game with
  // missing players.
  await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(games)
      .values({
        roomCode: snap.code,
        config: snap.config,
        status: 'completed',
        cluesGuessed: snap.cluesGuessed,
        endedAt: new Date(),
      })
      .returning();
    if (!game || results.length === 0) return;
    await tx.insert(gamePlayers).values(
      results.map((row) => ({
        gameId: game.id,
        displayName: row.displayName,
        finalScore: row.totalScore,
        finalRank: row.rank,
      })),
    );
  });
}
