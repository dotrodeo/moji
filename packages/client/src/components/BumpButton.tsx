import type { ActiveClueView } from '@moji/shared';
import { cn } from '../ui.js';

/**
 * Applause for a clue: it pays the author. Shown to solvers while guessing is
 * still open (the Guess screen's solved banner, `wide`) and to everyone on the
 * reveal, once the answer is out and a bump can't tip anybody off.
 */
export function BumpButton({
  clue,
  onBump,
  wide = false,
}: {
  clue: ActiveClueView;
  onBump: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onBump}
      disabled={!clue.youCanBump}
      className={cn(
        'items-center gap-2 rounded-pill border-sticker py-1.5 font-display text-sm font-extrabold transition-all',
        wide ? 'flex px-4' : 'inline-flex px-3',
        'hover:-translate-y-0.5 disabled:pointer-events-none',
        clue.youBumped
          ? 'border-outline bg-gold text-outline shadow-sticker-sm'
          : 'border-gold text-gold hover:bg-gold hover:text-outline',
      )}
    >
      👏 {clue.youBumped ? 'bumped' : wide ? 'bump this clue' : 'bump'}
      {clue.bumps > 0 && <span className="font-mono text-xs opacity-80">×{clue.bumps}</span>}
    </button>
  );
}
