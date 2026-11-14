/**
 * Library-wide confusables. Typo tolerance in the guess matcher is right for
 * slips ("titanc") and wrong for a different real title that happens to be one
 * or two letters away: "Splatoon" is not a misspelling of "Platoon", and "The
 * Witcher" is not "The Witches". For every prompt, any OTHER title in the
 * library (answer or alias) that the matcher would accept for it goes into its
 * blocklist, so typing that exact other title is never counted as a solve.
 * Typos of the real answer still are.
 *
 * Derived at load time from whatever content is live (database or bundled),
 * so it can't drift from the library and needs no curation. It runs on every
 * boot, so it mirrors isCorrectGuess's rule with everything normalized once
 * instead of calling it per pair (that took ~4 s on the full library).
 */
import { editDistance, normalize, numbersIn, tolerance } from '../game/guessMatching.js';
import type { PromptForPlay } from './ContentProvider.js';

interface Title {
  text: string;
  n: string;
  numbers: string;
  owners: Set<string>;
}

/** Adds confusable titles to each prompt's blocklist in place; returns how many were added. */
export function addConfusables(prompts: PromptForPlay[]): number {
  // Every distinct title in the library, normalized once.
  const titles = new Map<string, Title>();
  for (const p of prompts) {
    const owner = normalize(p.answer);
    for (const text of p.accepted) {
      const n = normalize(text);
      if (!n) continue;
      const entry = titles.get(n) ?? { text, n, numbers: numbersIn(n), owners: new Set<string>() };
      entry.owners.add(owner);
      titles.set(n, entry);
    }
  }
  const byLength = new Map<number, Title[]>();
  for (const t of titles.values()) {
    const list = byLength.get(t.n.length) ?? [];
    list.push(t);
    byLength.set(t.n.length, list);
  }

  let added = 0;
  for (const p of prompts) {
    const own = normalize(p.answer);
    const accepted = p.accepted.map(normalize).filter(Boolean);
    const acceptedSet = new Set(accepted);
    const blocked = new Set(p.blocklist.map(normalize));
    for (const a of accepted) {
      const reach = tolerance(a.length);
      if (reach === 0) continue; // exact-only: no other title can match it
      const numbers = numbersIn(a);
      for (let len = a.length - reach; len <= a.length + reach; len++) {
        for (const t of byLength.get(len) ?? []) {
          if (acceptedSet.has(t.n) || blocked.has(t.n) || t.owners.has(own)) continue;
          // Same rule as isCorrectGuess: numbers must agree, then within tolerance.
          if (t.numbers !== numbers || editDistance(a, t.n) > reach) continue;
          p.blocklist.push(t.text);
          blocked.add(t.n);
          added++;
        }
      }
    }
  }
  return added;
}
