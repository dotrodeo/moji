/**
 * Shared "sticker" UI primitives (design handoff §"sticker treatment").
 * Chunky outline + hard offset shadow; hover lifts, press sinks.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const AVATAR_BG = ['bg-pink', 'bg-cyan', 'bg-lime', 'bg-gold', 'bg-mint', 'bg-orange'];

/** Deterministic per-player avatar background color. */
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h + ch.charCodeAt(0)) % AVATAR_BG.length;
  return AVATAR_BG[h]!;
}

/** Rounded sticker avatar tile with a per-player background. */
export function Avatar({
  emoji,
  id,
  className,
}: {
  emoji: string;
  id: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-tile border-sticker border-outline shadow-sticker-sm',
        avatarColor(id),
        className,
      )}
    >
      {emoji}
    </span>
  );
}

interface SegmentedProps<T extends string | number> {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Accessible name for the group, e.g. the setting it controls. */
  label?: string;
}

/** Pill segmented control; selected segment is a gold sticker. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  label,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-1 rounded-pill border border-hairline2 bg-inset p-1"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            'rounded-pill px-3 py-1.5 font-mono text-sm transition-all disabled:opacity-50',
            o.value === value
              ? 'border-sticker border-outline bg-gold text-outline shadow-sticker-sm'
              : 'border-sticker border-transparent text-muted hover:text-paper',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Variant = 'lime' | 'pink' | 'cyan' | 'gold' | 'mint' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  lime: 'bg-lime text-outline border-outline shadow-sticker hover:shadow-sticker-hover',
  pink: 'bg-pink text-outline border-outline shadow-sticker hover:shadow-sticker-hover',
  cyan: 'bg-cyan text-outline border-outline shadow-sticker hover:shadow-sticker-hover',
  gold: 'bg-gold text-outline border-outline shadow-sticker hover:shadow-sticker-hover',
  mint: 'bg-mint text-outline border-outline shadow-sticker hover:shadow-sticker-hover',
  // Secondary CTA: transparent fill, pink border + pink hard shadow.
  outline:
    'bg-transparent text-paper border-pink shadow-sticker-pink hover:shadow-sticker-pink-hover',
};

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-7 py-3.5 text-lg',
};

interface StickerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function StickerButton({
  variant = 'lime',
  size = 'md',
  className,
  children,
  ...rest
}: StickerButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sticker border-sticker',
        'font-display font-extrabold transition-all duration-100',
        'hover:-translate-x-0.5 hover:-translate-y-0.5',
        'active:translate-x-0.5 active:translate-y-0.5 active:shadow-sticker-press',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Mono uppercase label (the recurring "eyebrow" above headlines). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('font-mono text-xs uppercase tracking-eyebrow text-muted', className)}>
      {children}
    </div>
  );
}

const CAPTION_TONE = {
  muted: 'text-muted',
  faint: 'text-muted-3',
  cyan: 'text-cyan',
} as const;

/**
 * The smaller mono label: 10px, tighter tracking. The eyebrow's little sibling.
 * Colour comes from `tone`, not a class, so two text colours never compete.
 */
export function Caption({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof CAPTION_TONE;
  className?: string;
}) {
  return (
    <div className={cn('font-mono text-caption uppercase tracking-caption', CAPTION_TONE[tone], className)}>
      {children}
    </div>
  );
}

/**
 * One emoji of a clue on its paper sticker tile. `lg` is the clue being
 * guessed (grows on wider screens); `sm` is everywhere else.
 */
export function ClueTile({
  emoji,
  size = 'sm',
  className,
}: {
  emoji: string;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex h-14 w-14 items-center justify-center rounded-tile border-sticker border-outline bg-paper text-3xl',
        size === 'lg' ? 'shadow-sticker sm:h-20 sm:w-20 sm:text-5xl' : 'shadow-sticker-sm',
        className,
      )}
    >
      {emoji}
    </span>
  );
}

/** Accent fill for a selected ToggleChip, by role. Literal classes so Tailwind keeps them. */
const CHIP_SELECTED = {
  pink: 'border-outline bg-pink text-outline shadow-sticker-sm',
  cyan: 'border-outline bg-cyan text-outline shadow-sticker-sm',
} as const;

/**
 * A pill that is on or off: emoji categories, pack choices. Idle is quiet;
 * selected becomes a sticker in its role's accent (pink = your selection,
 * cyan = information such as which pack).
 */
export function ToggleChip({
  selected,
  accent = 'pink',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; accent?: keyof typeof CHIP_SELECTED }) {
  return (
    <button
      {...rest}
      aria-pressed={selected}
      className={cn(
        'rounded-pill border-sticker transition-all disabled:opacity-50',
        selected ? CHIP_SELECTED[accent] : 'border-hairline2 text-muted hover:text-paper',
        className,
      )}
    >
      {children}
    </button>
  );
}

const TEXT_TONE = {
  muted: 'text-muted hover:text-paper',
  cyan: 'text-cyan hover:text-cyan-light',
} as const;

/** A button that reads as a link: back, leave, copy. */
export function TextButton({
  tone = 'muted',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TEXT_TONE }) {
  return (
    <button {...rest} className={cn('text-sm', TEXT_TONE[tone], className)}>
      {children}
    </button>
  );
}

const BANNER = {
  status: 'z-20 bg-orange py-1 font-mono text-xs uppercase tracking-eyebrow',
  error: 'z-30 cursor-pointer bg-coral px-4 py-2 text-sm font-semibold',
  info: 'z-30 cursor-pointer bg-cyan px-4 py-2 text-sm font-semibold',
} as const;

/**
 * A full-width bar pinned to the top. `status` (orange) is connection state,
 * `error` (coral) a failed command, `info` (cyan) a notice. Errors are alerts;
 * the others are polite status updates.
 */
export function Banner({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof BANNER;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      onClick={onClick}
      className={cn('fixed inset-x-0 top-0 text-center text-outline', BANNER[tone])}
    >
      {children}
    </div>
  );
}

const FIELD_ROLE = {
  // Guessing and searching: the "go" accent.
  lime: 'border-hairline2 focus:border-lime',
  // Your name: you.
  pink: 'border-hairline2 focus:border-pink',
  // The solvers' chat: an information space, tinted even at rest.
  cyan: 'border-cyan/40 focus:border-cyan',
} as const;

/**
 * Classes for a text input. The focus colour follows the accent roles, so the
 * caller says which role the field plays. Add padding and text size per use.
 */
export function fieldClass(role: keyof typeof FIELD_ROLE): string {
  return cn('w-full rounded-tile border-2 bg-inset outline-none disabled:opacity-50', FIELD_ROLE[role]);
}

/** A bordered panel/card surface. */
export function Panel({
  children,
  className,
  pop = false,
}: {
  children: ReactNode;
  className?: string;
  pop?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-hairline2 bg-panel',
        pop && 'animate-moji-pop',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The MOJI wordmark — 4 rotated sticker letter-tiles. */
const LETTERS: Array<{ ch: string; fill: string; rot: string }> = [
  { ch: 'M', fill: 'bg-pink', rot: '-rotate-3' },
  { ch: 'O', fill: 'bg-cyan', rot: 'rotate-2' },
  { ch: 'J', fill: 'bg-lime', rot: '-rotate-2' },
  { ch: 'I', fill: 'bg-gold', rot: 'rotate-3' },
];

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const tile =
    size === 'lg' ? 'h-16 w-16 text-4xl sm:h-20 sm:w-20 sm:text-5xl' : 'h-11 w-11 text-2xl';
  return (
    <div className="flex items-center gap-1.5">
      {LETTERS.map((l) => (
        <span
          key={l.ch}
          className={cn(
            'inline-flex items-center justify-center rounded-tile border-sticker border-outline',
            'font-display font-extrabold text-outline shadow-sticker-sm',
            l.fill,
            l.rot,
            tile,
          )}
        >
          {l.ch}
        </span>
      ))}
    </div>
  );
}
