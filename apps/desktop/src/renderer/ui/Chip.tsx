import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

type Tone = 'neutral' | 'iris' | 'success' | 'warning' | 'danger' | 'info';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colored tones are for STATUS/DATA only (§3.0.2) — chrome stays neutral. */
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted hairline',
  iris: 'bg-iris/10 text-iris border border-iris/20',
  success: 'bg-success/10 text-success border border-success/20',
  warning: 'bg-warning/10 text-warning border border-warning/20',
  danger: 'bg-danger/10 text-danger border border-danger/20',
  info: 'bg-info/10 text-info border border-info/20',
};

export function Chip({ tone = 'neutral', icon, className, children, ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-label font-medium tracking-[0.02em] uppercase',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
