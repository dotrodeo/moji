/**
 * Runtime checks for everything a client sends. The event types in
 * @moji/shared describe what OUR client sends; they vanish at runtime, and the
 * socket is open to any client. Each parser returns a payload the rest of the
 * server can trust (right types, bounded sizes) or throws an Error whose
 * message is safe to show the player.
 *
 * Every new client→server event needs a parser here. Anything a payload puts
 * into room state is fanned out to every player, so an unchecked field is a
 * way to crash their browsers or multiply bandwidth.
 */
import {
  MAX_GUESS_LENGTH,
  isAvatar,
  type ClueChatPayload,
  type ConfigureRoomPayload,
  type JoinRoomPayload,
  type PackMode,
  type SubmitCluePayload,
  type SubmitGuessPayload,
} from '@moji/shared';

/** Socket.IO's per-message ceiling. The largest legitimate message is a clue. */
export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Room.ts trims chat to 200; this only bounds what we accept to trim. */
export const MAX_CHAT_LENGTH = 500;
/** Longest legitimate single emoji (a ZWJ family or a tag-sequence flag) is ~14 UTF-16 units. */
export const MAX_EMOJI_UNITS = 32;
/** Room.ts enforces the real 1–10 rule with a friendly message; this bounds the array. */
const MAX_CLUE_ENTRIES = 20;
const MAX_NAME_INPUT = 100;
const MAX_TOKEN_LENGTH = 512;
const ROOM_CODE = /^[A-Za-z0-9]{1,10}$/;
const PACK_MODES: readonly PackMode[] = ['shared', 'mixed'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(what: string): Error {
  return new Error(`Invalid ${what}.`);
}

export function parseJoin(payload: unknown): JoinRoomPayload {
  if (!isObject(payload)) throw invalid('request');
  const { code, displayName, avatar, asSpectator, solo, sessionToken } = payload;

  let parsedCode: string | undefined;
  if (code !== undefined && code !== null && code !== '') {
    if (typeof code !== 'string' || !ROOM_CODE.test(code)) throw invalid('room code');
    parsedCode = code;
  }
  if (typeof displayName !== 'string') throw invalid('name');

  return {
    code: parsedCode,
    // RoomManager trims to 20; this just keeps an enormous string out of it.
    displayName: displayName.slice(0, MAX_NAME_INPUT),
    // Not a hard error: an unknown avatar quietly becomes the default.
    avatar: isAvatar(avatar) ? avatar : undefined,
    asSpectator: asSpectator === true,
    solo: solo === true,
    sessionToken:
      typeof sessionToken === 'string' && sessionToken.length <= MAX_TOKEN_LENGTH
        ? sessionToken
        : undefined,
  };
}

const NUMERIC_CONFIG = [
  'rounds',
  'clueCreationSeconds',
  'guessingSeconds',
  'reshuffles',
  'reshuffleCost',
] as const;

export function parseConfigure(payload: unknown): ConfigureRoomPayload {
  if (!isObject(payload)) throw invalid('settings');
  const out: ConfigureRoomPayload = {};
  for (const key of NUMERIC_CONFIG) {
    const value = payload[key];
    if (value === undefined) continue;
    // NaN here used to mean no phase timer at all, or a game that never ends.
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('settings');
    out[key] = Math.round(value);
  }
  if (payload.packSlug !== undefined) {
    if (typeof payload.packSlug !== 'string' || payload.packSlug.length > 64) throw invalid('pack');
    out.packSlug = payload.packSlug; // existence is checked by Room against the loaded packs
  }
  if (payload.packMode !== undefined) {
    if (!PACK_MODES.includes(payload.packMode as PackMode)) throw invalid('pack mode');
    out.packMode = payload.packMode as PackMode;
  }
  return out;
}

export function parseReady(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid('ready state');
  return value;
}

export function parseClue(payload: unknown): SubmitCluePayload {
  if (!isObject(payload) || !Array.isArray(payload.emojis)) throw invalid('clue');
  const emojis = payload.emojis;
  if (emojis.length > MAX_CLUE_ENTRIES) throw invalid('clue');
  for (const e of emojis) {
    if (typeof e !== 'string' || e.length === 0 || e.length > MAX_EMOJI_UNITS) throw invalid('clue');
  }
  return { emojis: emojis as string[] };
}

export function parseGuess(payload: unknown): SubmitGuessPayload {
  if (!isObject(payload) || typeof payload.text !== 'string') throw invalid('guess');
  if (payload.text.length > MAX_GUESS_LENGTH) throw new Error('That guess is too long.');
  return { text: payload.text };
}

export function parseChat(payload: unknown): ClueChatPayload {
  if (!isObject(payload) || typeof payload.text !== 'string') throw invalid('message');
  if (payload.text.length > MAX_CHAT_LENGTH) throw new Error('That message is too long.');
  return { text: payload.text };
}
