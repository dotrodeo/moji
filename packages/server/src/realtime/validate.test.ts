import { describe, expect, it } from 'vitest';
import {
  MAX_EMOJI_UNITS,
  parseChat,
  parseClue,
  parseConfigure,
  parseGuess,
  parseJoin,
  parseReady,
} from './validate.js';

describe('parseJoin', () => {
  it('passes a well-formed request through', () => {
    expect(parseJoin({ displayName: 'Alice', avatar: '🦊', code: 'abcde', sessionToken: 't' })).toEqual({
      code: 'abcde',
      displayName: 'Alice',
      avatar: '🦊',
      asSpectator: false,
      solo: false,
      sessionToken: 't',
    });
  });

  it.each([null, undefined, 'str', 42, []])('rejects a non-object payload (%s)', (p) => {
    expect(() => parseJoin(p)).toThrow('Invalid request.');
  });

  it('requires a string name', () => {
    expect(() => parseJoin({ displayName: { x: 1 } })).toThrow('Invalid name.');
  });

  it('rejects codes outside the code alphabet or length', () => {
    expect(() => parseJoin({ displayName: 'A', code: 'AB-CD' })).toThrow('Invalid room code.');
    expect(() => parseJoin({ displayName: 'A', code: 'A'.repeat(11) })).toThrow('Invalid room code.');
    expect(() => parseJoin({ displayName: 'A', code: 12345 })).toThrow('Invalid room code.');
  });

  it('treats an empty code as "create a room"', () => {
    expect(parseJoin({ displayName: 'A', code: '' }).code).toBeUndefined();
  });

  it('drops avatars outside the picker list instead of storing them', () => {
    for (const avatar of [{}, 'x'.repeat(10_000), '🦁', 7]) {
      expect(parseJoin({ displayName: 'A', avatar }).avatar).toBeUndefined();
    }
  });

  it('only honours real booleans and bounded tokens', () => {
    const r = parseJoin({ displayName: 'A', solo: 'yes', asSpectator: 1, sessionToken: 'x'.repeat(600) });
    expect(r.solo).toBe(false);
    expect(r.asSpectator).toBe(false);
    expect(r.sessionToken).toBeUndefined();
  });

  it('bounds the name it hands on', () => {
    expect(parseJoin({ displayName: 'n'.repeat(5000) }).displayName.length).toBe(100);
  });
});

describe('parseConfigure', () => {
  it('rounds finite numbers and keeps known fields', () => {
    expect(parseConfigure({ rounds: 3.6, packMode: 'mixed', packSlug: 'disney' })).toEqual({
      rounds: 4,
      packMode: 'mixed',
      packSlug: 'disney',
    });
  });

  it.each([NaN, Infinity, '5', null, {}])('rejects a non-finite or non-number value (%s)', (v) => {
    expect(() => parseConfigure({ guessingSeconds: v })).toThrow('Invalid settings.');
  });

  it('rejects an unknown pack mode', () => {
    expect(() => parseConfigure({ packMode: 'chaos' })).toThrow('Invalid pack mode.');
  });

  it('ignores fields it does not know', () => {
    expect(parseConfigure({ mode: 'solo', hostId: 'me' })).toEqual({});
  });
});

describe('parseReady', () => {
  it('accepts only booleans', () => {
    expect(parseReady(true)).toBe(true);
    expect(() => parseReady('true')).toThrow('Invalid ready state.');
  });
});

describe('parseClue', () => {
  it('accepts an array of short strings', () => {
    expect(parseClue({ emojis: ['🦁', '👑'] })).toEqual({ emojis: ['🦁', '👑'] });
  });

  it('rejects a string where the array should be', () => {
    // A string would iterate as emoji and pass the rules, then crash every
    // client's `clue.emojis.map` when the clue played.
    expect(() => parseClue({ emojis: '🦁👑' })).toThrow('Invalid clue.');
  });

  it('rejects non-string, empty and oversized entries', () => {
    expect(() => parseClue({ emojis: [{}] })).toThrow('Invalid clue.');
    expect(() => parseClue({ emojis: [''] })).toThrow('Invalid clue.');
    expect(() => parseClue({ emojis: ['🦁' + '́'.repeat(MAX_EMOJI_UNITS)] })).toThrow('Invalid clue.');
    expect(() => parseClue({ emojis: Array(21).fill('🦁') })).toThrow('Invalid clue.');
  });

  it('leaves the 1-10 rule to Room, which explains it to the player', () => {
    expect(parseClue({ emojis: Array(11).fill('🦁') }).emojis).toHaveLength(11);
  });
});

describe('parseGuess / parseChat', () => {
  it('accept strings within their limits', () => {
    expect(parseGuess({ text: 'the lion king' })).toEqual({ text: 'the lion king' });
    expect(parseChat({ text: 'nice clue' })).toEqual({ text: 'nice clue' });
  });

  it('reject non-strings and oversized text', () => {
    expect(() => parseGuess({ text: ['a'] })).toThrow('Invalid guess.');
    expect(() => parseGuess({ text: 'x'.repeat(101) })).toThrow('That guess is too long.');
    expect(() => parseChat(null)).toThrow('Invalid message.');
    expect(() => parseChat({ text: 'x'.repeat(501) })).toThrow('That message is too long.');
  });
});
