import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** compact = 20px padding · feature = 24px (§3.3) */
  padding?: 'compact' | 'feature' | 'none';
  /** Interactive cards step one rung up the surface ladder on hover. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'compact', interactive, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[14px] bg-surface-1 hairline',
        padding === 'compact' && 'p-5',
        padding === 'feature' && 'p-6',
        interactive &&
          'transition-colors duration-150 hover:bg-surface-2 hover:border-line-strong cursor-default',
        className,
      )}
      {...rest}
    />
  );
});
