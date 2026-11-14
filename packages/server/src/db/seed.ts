/** CLI: seed categories + prompts into Postgres. Run via `npm run db:seed`. */
import { db } from './client.js';
import { seedDatabase } from './seedDatabase.js';

async function main() {
  const r = await seedDatabase(db);
  console.log(
    `Seed complete: ${r.categories} categories; ${r.inserted} inserted, ${r.updated} updated, ` +
      `${r.retired} retired, ${r.restored} restored.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
