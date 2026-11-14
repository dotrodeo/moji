/**
 * Reconcile the database's content with the code's (content/seedData.ts) on
 * every boot, so a content edit takes effect on the next deploy:
 *   - categories are upserted (name, description, order) and those absent from
 *     the seed are deactivated;
 *   - a prompt is identified by (pack, answer), so the same title can live in
 *     two packs as two rows;
 *   - new prompts are inserted; existing ones get difficulty, popularity and
 *     accepted answers (canonical + aliases) brought in line with the code;
 *   - prompts no longer in the code are RETIRED, never deleted: game history
 *     references them. A retired prompt that comes back is re-approved.
 *   - blocklist rows (`is_blocklist`) are curated in the database and left alone.
 *
 * All of it runs in one transaction under an advisory lock, so a crash midway
 * leaves the previous content intact (a prompt can't end up with no answers),
 * and two servers booting at once can't both seed.
 *
 * Shared by the `db:seed` CLI and the startup bootstrap.
 */
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { categories, promptAnswers, prompts } from './schema.js';
import { SEED_CATEGORIES, type SeedCategory } from '../content/seedData.js';

/** Arbitrary constant naming "the content seed" for pg_advisory_xact_lock. */
const SEED_LOCK = 4_271_002;

export interface SeedReport {
  categories: number;
  inserted: number;
  updated: number;
  retired: number;
  restored: number;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const keyOf = (categoryId: string, answer: string) => `${categoryId}\u0000${answer}`;

/** Canonical first, then aliases in seed order: the shape stored in prompt_answers. */
function seedAnswers(p: { answer: string; aliases?: string[] }) {
  return [
    { text: p.answer, matchType: 'canonical' },
    ...(p.aliases ?? []).map((text) => ({ text, matchType: 'alias' })),
  ];
}

export async function seedDatabase(
  db: Db,
  seed: SeedCategory[] = SEED_CATEGORIES,
): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
    const categoryId = await upsertCategories(tx, seed);

    const existing = await tx
      .select({
        id: prompts.id,
        answer: prompts.answer,
        categoryId: prompts.categoryId,
        status: prompts.status,
        difficulty: prompts.difficulty,
        popularity: prompts.popularity,
      })
      .from(prompts);
    const byKey = new Map(existing.map((p) => [keyOf(p.categoryId, p.answer), p]));

    // Every prompt's accepted answers (not blocklist) in one query, for comparison.
    const answerRows = await tx
      .select({ promptId: promptAnswers.promptId, text: promptAnswers.text, matchType: promptAnswers.matchType })
      .from(promptAnswers)
      .where(eq(promptAnswers.isBlocklist, false));
    const answersOf = new Map<string, string[]>();
    for (const r of answerRows) {
      const list = answersOf.get(r.promptId) ?? [];
      list.push(`${r.matchType}:${r.text}`);
      answersOf.set(r.promptId, list);
    }

    const writeAnswers = async (promptId: string, p: { answer: string; aliases?: string[] }) => {
      await tx
        .delete(promptAnswers)
        .where(and(eq(promptAnswers.promptId, promptId), eq(promptAnswers.isBlocklist, false)));
      await tx.insert(promptAnswers).values(seedAnswers(p).map((a) => ({ promptId, ...a })));
    };

    const report: SeedReport = { categories: seed.length, inserted: 0, updated: 0, retired: 0, restored: 0 };
    const seededKeys = new Set<string>();

    for (const cat of seed) {
      const cid = categoryId.get(cat.slug)!;
      for (const p of cat.prompts) {
        const key = keyOf(cid, p.answer);
        seededKeys.add(key);
        const row = byKey.get(key);
        if (!row) {
          const [inserted] = await tx
            .insert(prompts)
            .values({
              categoryId: cid,
              answer: p.answer,
              difficulty: p.difficulty,
              popularity: p.popularity,
              status: 'approved',
            })
            .returning({ id: prompts.id });
          await writeAnswers(inserted!.id, p);
          report.inserted++;
          continue;
        }

        const fieldsChanged =
          row.status !== 'approved' || row.difficulty !== p.difficulty || row.popularity !== p.popularity;
        if (fieldsChanged) {
          if (row.status === 'retired') report.restored++;
          await tx
            .update(prompts)
            .set({ status: 'approved', difficulty: p.difficulty, popularity: p.popularity, updatedAt: new Date() })
            .where(eq(prompts.id, row.id));
        }
        const want = seedAnswers(p).map((a) => `${a.matchType}:${a.text}`).sort();
        const have = [...(answersOf.get(row.id) ?? [])].sort();
        const answersChanged = want.join('\n') !== have.join('\n');
        if (answersChanged) await writeAnswers(row.id, p);
        if (fieldsChanged || answersChanged) report.updated++;
      }
    }

    // Retire what the code no longer has. Only approved rows: anything a person
    // put in draft or review by hand is theirs to manage.
    const toRetire = existing.filter((p) => p.status === 'approved' && !seededKeys.has(keyOf(p.categoryId, p.answer)));
    if (toRetire.length) {
      await tx
        .update(prompts)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(inArray(prompts.id, toRetire.map((p) => p.id)));
      report.retired = toRetire.length;
    }

    const activeSlugs = seed.map((c) => c.slug);
    await tx.update(categories).set({ isActive: true }).where(inArray(categories.slug, activeSlugs));
    await tx.update(categories).set({ isActive: false }).where(notInArray(categories.slug, activeSlugs));

    return report;
  });
}

async function upsertCategories(tx: Tx, seed: SeedCategory[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [i, cat] of seed.entries()) {
    const [row] = await tx
      .insert(categories)
      .values({ slug: cat.slug, name: cat.name, description: cat.description, sortOrder: i })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: cat.name, description: cat.description, sortOrder: i },
      })
      .returning({ id: categories.id });
    ids.set(cat.slug, row!.id);
  }
  return ids;
}
