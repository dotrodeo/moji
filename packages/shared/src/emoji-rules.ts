/**
 * Emoji clue validation (design doc Rules + Anti-Cheat §7).
 *
 * Enforced on BOTH client (instant UX feedback) and server (authoritative).
 * The custom in-app picker only surfaces allowed emoji, so these checks are a
 * backstop against tampering and pasted input.
 *
 * NOTE: robust emoji segmentation is genuinely hard. We use Intl.Segmenter
 * where available (Node 20+, modern browsers) and fall back to code points.
 * This is intentionally conservative and can be refined with a vetted library
 * (e.g. emoji-regex / unicode segmentation tables) if edge cases bite.
 */

export const MIN_EMOJIS = 1;
export const MAX_EMOJIS = 10;

export interface ClueValidationOptions {
  /** true when the prompt's answer contains a digit -> number emojis are banned */
  promptHasNumber: boolean;
  /**
   * Normalized tokens that must not appear (e.g. the answer words). Used for the
   * "no direct spelling" rule; usually supplied server-side from the prompt.
   */
  forbiddenTokens?: string[];
}

export interface ClueValidationResult {
  ok: boolean;
  errors: string[];
}

/** Split a string into user-perceived characters (grapheme clusters). */
export function splitGraphemes(input: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const seg = new Seg(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(input), (s) => s.segment);
  }
  return Array.from(input);
}

const LETTER_EMOJI = [
  /[\u{1F170}\u{1F171}\u{1F17E}\u{1F17F}]/u, // 🅰 🅱 🅾 🅿
  /[\u{1F18A}-\u{1F18F}]/u, // 🆎 etc.
  /[\u{1F191}-\u{1F19A}]/u, // 🆑 🆒 🆓 ... 🆚 (squared latin)
  /[\u{1F520}-\u{1F524}]/u, // 🔠 🔡 🔢 🔣 🔤 input-symbol letters
  /[\u{24B6}-\u{24E9}]/u, // circled latin letters
];

const KEYCAP = /[#*0-9]️?⃣/u; // # * 0–9 keycaps
const ENCLOSED_DIGIT = /[①-⑳⓪⓵-⓾❶-❿]/u; // ①..⑳ etc.
const KEYCAP_TEN = /\u{1F51F}/u; // 🔟

/** Count regional-indicator code points (A–Z symbols that compose flags). */
function regionalIndicatorCount(grapheme: string): number {
  let n = 0;
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) n++;
  }
  return n;
}

function isLetterEmoji(grapheme: string): boolean {
  // A LONE regional indicator (🇦) is a letter used to spell — blocked. A flag
  // (a pair, 🇫🇷) is a legitimate clue emoji and is allowed.
  if (regionalIndicatorCount(grapheme) === 1) return true;
  return LETTER_EMOJI.some((re) => re.test(grapheme));
}

function isNumberEmoji(grapheme: string): boolean {
  return KEYCAP.test(grapheme) || ENCLOSED_DIGIT.test(grapheme) || KEYCAP_TEN.test(grapheme);
}

/** Plain ASCII/letters/digits are "text", which is not allowed in clues. */
function containsPlainText(grapheme: string): boolean {
  return /[A-Za-z0-9]/.test(grapheme);
}

/** Does the grapheme contain at least one pictographic code point (or a flag)? */
function isPictographic(grapheme: string): boolean {
  return /\p{Extended_Pictographic}/u.test(grapheme) || regionalIndicatorCount(grapheme) > 0;
}

/** Longest real single emoji is a tag-sequence flag (14 UTF-16 units); this leaves headroom. */
const MAX_EMOJI_UNITS = 32;
/** A family emoji (👨‍👩‍👧‍👦) joins four parts; nothing real joins more. */
const MAX_ZWJ_PARTS = 4;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f;
/** Marks that belong in emoji: text/emoji variation selectors and the keycap enclosure. */
const EMOJI_MARKS = new Set([0xfe0e, 0xfe0f, 0x20e3]);

let regionNames: Intl.DisplayNames | null | undefined;
/** Is this two-letter code a real region (so the pair renders as a flag, not two boxed letters)? */
function isRegion(code: string): boolean {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      regionNames = null; // no Intl.DisplayNames: don't block flags we can't check
    }
  }
  if (!regionNames) return true;
  const name = regionNames.of(code);
  return name !== undefined && code !== 'ZZ';
}

/**
 * Is this grapheme shaped like one real emoji? Grapheme segmentation alone
 * accepts things that only look like one character:
 *   - letters spelled with invalid regional-indicator pairs (🇯🇦 🇼🇸 reads "JAWS"),
 *   - long ZWJ chains (30 joined 🦁 count as "one emoji", past the 10 cap),
 *   - an emoji carrying thousands of combining marks, broadcast to every player.
 */
function isWellFormedEmoji(grapheme: string): boolean {
  if (grapheme.length > MAX_EMOJI_UNITS) return false;
  const cps = Array.from(grapheme, (ch) => ch.codePointAt(0)!);
  let zwj = 0;
  for (const cp of cps) {
    const ch = String.fromCodePoint(cp);
    if (cp === ZWJ) {
      zwj++;
      continue;
    }
    if (isTag(cp)) {
      // Tags only make sense inside a subdivision flag (🏴󠁧󠁢󠁳󠁣󠁴󠁿).
      if (cps[0] !== BLACK_FLAG) return false;
      continue;
    }
    if (/\p{M}/u.test(ch) && !EMOJI_MARKS.has(cp)) return false;
    if (/\p{Cf}/u.test(ch)) return false;
  }
  if (zwj + 1 > MAX_ZWJ_PARTS) return false;

  const regional = cps.filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
  if (regional.length > 2) return false;
  if (regional.length === 2) {
    const code = regional.map((cp) => String.fromCharCode(cp - 0x1f1e6 + 65)).join('');
    if (!isRegion(code)) return false;
  }
  return true;
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

export function validateClue(
  emojis: string[],
  opts: ClueValidationOptions,
): ClueValidationResult {
  const errors: string[] = [];

  if (emojis.length < MIN_EMOJIS) errors.push(`Use at least ${MIN_EMOJIS} emoji.`);
  if (emojis.length > MAX_EMOJIS) errors.push(`Use at most ${MAX_EMOJIS} emojis.`);

  for (const raw of emojis) {
    // Each entry should be exactly one emoji grapheme.
    const graphemes = splitGraphemes(raw);
    if (graphemes.length !== 1) {
      errors.push(`"${raw}" is not a single emoji.`);
      continue;
    }
    const g = graphemes[0]!;
    if (!isWellFormedEmoji(g)) {
      errors.push(`"${g.slice(0, 8)}" is not a valid emoji.`);
      continue;
    }
    const letter = isLetterEmoji(g);
    const number = isNumberEmoji(g);
    // A keycap/enclosed-number emoji (e.g. 1️⃣) contains an ASCII digit code
    // point but is still an emoji, so classify it before the plain-text check.
    const isEmoji = letter || number || isPictographic(g);

    if (!isEmoji) {
      errors.push(
        containsPlainText(g)
          ? 'Text, letters, and numbers are not allowed.'
          : `"${g}" is not a valid emoji.`,
      );
      continue;
    }
    if (letter) errors.push('Letter emojis are not allowed.');
    // Number emojis are allowed unless the prompt itself contains a number.
    if (number && opts.promptHasNumber) {
      errors.push('Number emojis are not allowed for this prompt.');
    }
  }

  // "No direct spelling of the answer": reject if the concatenated clue, once
  // stripped to letters/digits, contains a forbidden answer token. (Backstop;
  // emojis rarely normalize to letters, but pasted text would be caught above.)
  if (opts.forbiddenTokens?.length) {
    const flat = normalizeToken(emojis.join(''));
    for (const tok of opts.forbiddenTokens) {
      const n = normalizeToken(tok);
      if (n.length >= 3 && flat.includes(n)) {
        errors.push('Clues may not spell out the answer.');
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/** Does a prompt answer contain a digit? (drives the number-emoji rule) */
export function promptHasNumber(answer: string): boolean {
  return /\d/.test(answer);
}

/**
 * The number-emoji rule for a whole prompt: banned when the answer OR any
 * accepted alias has a digit. "Frozen II" is spelled out, but its alias
 * "Frozen 2" means 2️⃣ spells it all the same.
 */
export function anyHasNumber(texts: readonly string[]): boolean {
  return texts.some(promptHasNumber);
}
