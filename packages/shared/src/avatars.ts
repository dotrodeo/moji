/**
 * Avatar emoji a player can pick at Join (design handoff §2). Shared so the
 * server can accept exactly this set: an avatar is stored and sent to every
 * player in the room, so anything else (an object, a megabyte of text) would
 * be broadcast to all of them.
 */
export const AVATARS = ['😎', '🦊', '👽', '🐙', '🤖', '🦄', '🐸', '🐯', '👻', '🍕', '🌈', '🔥'] as const;

export const DEFAULT_AVATAR = '😎';

export function isAvatar(value: unknown): value is (typeof AVATARS)[number] {
  return typeof value === 'string' && (AVATARS as readonly string[]).includes(value);
}
