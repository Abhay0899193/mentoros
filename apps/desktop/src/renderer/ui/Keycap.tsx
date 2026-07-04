import { cn } from '../lib/cn';

export interface KeycapProps {
  /** e.g. "⌘" "K" "⏎" — pass one cap per Keycap, compose in a row. */
  children: string;
  /** Render in the depressed position (used when the bound key is held). */
  pressed?: boolean;
  className?: string;
}

/** Inline keyboard hint (§0.5 Superhuman). Depresses 1px when pressed. */
export function Keycap({ children, pressed, className }: KeycapProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-1',
        'bg-surface-2 font-mono text-[11px] text-muted',
        'border border-line border-b-2 border-b-line-strong',
        'transition-[transform,border-bottom-width] duration-100',
        pressed && 'translate-y-px border-b',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
