import { beforeAll, describe, expect, it } from 'vitest';
import { ContentProvider, promptKey, type PromptForPlay } from './ContentProvider.js';
import { isCorrectGuess, normalize } from '../game/guessMatching.js';
import type { Db } from '../db/client.js';

/** The real bundled library, loaded exactly as production does when the DB is unavailable. */
const failingDb = {
  select: () => {
    throw new Error('no database in tests');
  },
} as unknown as Db;

let content: ContentProvider;
let packs: Map<string, PromptForPlay[]>;
let all: PromptForPlay[];
let loadMs: number;

beforeAll(async () => {
  const t = performance.now();
  content = new ContentProvider(failingDb);
  await content.load();
  loadMs = performance.now() - t;
  const byCategory = (content as unknown as { byCategory: Map<string, { prompts: PromptForPlay[] }> })
    .byCategory;
  packs = new Map([...byCategory].map(([slug, c]) => [slug, c.prompts]));
  all = [...packs.values()].flat();
});

describe('the bundled library', () => {
  it('loads (confusables included) fast enough to do on every boot', () => {
    expect(loadMs).toBeLessThan(5000);
  });

  it('every prompt is still solvable by its own answer and aliases', () => {
    for (const p of all) {
      for (const text of p.accepted) expect(isCorrectGuess(text, p), `${text} → ${p.answer}`).toBe(true);
    }
  });

  it('no other title in the library, typed exactly, solves a prompt', () => {
    // Only titles within the matcher's widest reach (2 edits) can possibly match.
    const titles = [...new Set(all.map((p) => p.answer))].map((t) => ({ t, n: normalize(t) }));
    const wrong: string[] = [];
    for (const p of all) {
      const own = normalize(p.answer);
      for (const { t, n } of titles) {
        if (n === own || Math.abs(n.length - own.length) > 2) continue;
        if (isCorrectGuess(t, p)) wrong.push(`"${t}" solved "${p.answer}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('sequels are told apart', () => {
    const find = (answer: string) => all.find((p) => p.answer === answer);
    const ts2 = find('Toy Story 2');
    if (ts2) expect(isCorrectGuess('Toy Story 3', ts2)).toBe(false);
    const cars2 = find('Cars 2');
    if (cars2) expect(isCorrectGuess('Cars 3', cars2)).toBe(false);
  });
});

describe('dealing', () => {
  it('uses every unused prompt in a pack before repeating one, and never repeats an answer in a round', () => {
    const [slug, prompts] = [...packs].sort((a, b) => a[1].length - b[1].length)[0]!;
    const size = new Set(prompts.map((p) => normalize(p.answer))).size;
    const used = new Set<string>();
    let seed = 1;
    const pick = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let fresh = 0;
    for (let round = 0; round < 10; round++) {
      const deal = content.dealRound([slug], 12, used, pick)!;
      const answers = deal.assignments.map((p) => normalize(p.answer));
      expect(new Set(answers).size, 'same answer twice in one round').toBe(answers.length);
      for (const p of deal.assignments) {
        if (!used.has(promptKey(p))) fresh++;
        else expect(fresh, 'repeated a prompt while unused ones were left').toBeGreaterThan(size - 12);
        used.add(promptKey(p));
      }
    }
    expect(fresh).toBe(size);
  });
});
