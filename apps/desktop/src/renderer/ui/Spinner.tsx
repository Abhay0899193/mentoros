import { cn } from '../lib/cn';

/** Hairline ring spinner — pair with a status label; never spin in silence. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-ink',
        'motion-reduce:animate-[spin_1.5s_linear_infinite]',
        className,
      )}
    />
  );
}
