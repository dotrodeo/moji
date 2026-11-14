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
 * so it can't drift from the library and needs no curation.
 */
import { isCorrectGuess, normalize } from '../game/guessMatching.js';
import type { PromptForPlay } from './ContentProvider.js';

/** The matcher's widest tolerance is 2 edits, so longer gaps can't match. */
const MAX_LENGTH_GAP = 2;

/** Adds confusable titles to each prompt's blocklist in place; returns how many were added. */
export function addConfusables(prompts: PromptForPlay[]): number {
  // Every distinct title in the library, with the normalized answers it belongs to.
  const titles = new Map<string, { text: string; owners: Set<string> }>();
  for (const p of prompts) {
    const owner = normalize(p.answer);
    for (const text of p.accepted) {
      const n = normalize(text);
      if (!n) continue;
      const entry = titles.get(n) ?? { text, owners: new Set<string>() };
      entry.owners.add(owner);
      titles.set(n, entry);
    }
  }
  const byLength = new Map<number, string[]>();
  for (const n of titles.keys()) {
    const list = byLength.get(n.length) ?? [];
    list.push(n);
    byLength.set(n.length, list);
  }

  let added = 0;
  for (const p of prompts) {
    const own = normalize(p.answer);
    const accepted = new Set(p.accepted.map(normalize));
    const blocked = new Set(p.blocklist.map(normalize));
    const lengths = new Set([...accepted].map((a) => a.length));
    const candidates = new Set<string>();
    for (const len of lengths) {
      for (let d = -MAX_LENGTH_GAP; d <= MAX_LENGTH_GAP; d++) {
        for (const n of byLength.get(len + d) ?? []) candidates.add(n);
      }
    }
    for (const n of candidates) {
      const entry = titles.get(n)!;
      // The same title filed twice (two packs, or punctuation variants of one
      // answer) is not a different title.
      if (accepted.has(n) || blocked.has(n) || entry.owners.has(own)) continue;
      if (isCorrectGuess(entry.text, { accepted: p.accepted })) {
        p.blocklist.push(entry.text);
        blocked.add(n);
        added++;
      }
    }
  }
  return added;
}
