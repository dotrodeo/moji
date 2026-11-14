import { describe, expect, it } from 'vitest';
import { addConfusables } from './confusables.js';
import { isCorrectGuess } from '../game/guessMatching.js';
import type { PromptForPlay } from './ContentProvider.js';

const prompt = (answer: string, aliases: string[] = []): PromptForPlay => ({
  id: answer,
  answer,
  accepted: [answer, ...aliases],
  blocklist: [],
  difficulty: 1,
});

describe('addConfusables', () => {
  it('blocklists another real title the typo tolerance would have accepted', () => {
    const platoon = prompt('Platoon');
    const splatoon = prompt('Splatoon');
    const witches = prompt('The Witches');
    const witcher = prompt('The Witcher');
    addConfusables([platoon, splatoon, witches, witcher]);
    expect(isCorrectGuess('Splatoon', platoon)).toBe(false);
    expect(isCorrectGuess('Platoon', splatoon)).toBe(false);
    expect(isCorrectGuess('The Witcher', witches)).toBe(false);
    expect(isCorrectGuess('The Witches', witcher)).toBe(false);
  });

  it('keeps forgiving real typos of the answer itself', () => {
    const platoon = prompt('Platoon');
    addConfusables([platoon, prompt('Splatoon')]);
    expect(isCorrectGuess('Plattoon', platoon)).toBe(true);
    expect(isCorrectGuess('platoon', platoon)).toBe(true);
  });

  it('does not treat the same title filed in two packs as a confusable', () => {
    const a = prompt('Twister');
    const b = prompt('Twister');
    expect(addConfusables([a, b])).toBe(0);
    expect(isCorrectGuess('Twister', a)).toBe(true);
  });

  it('leaves unrelated titles alone', () => {
    const titanic = prompt('Titanic');
    expect(addConfusables([titanic, prompt('Jaws'), prompt('Inception')])).toBe(0);
    expect(titanic.blocklist).toEqual([]);
  });
});
