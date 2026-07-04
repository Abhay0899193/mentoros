import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  /** Right-aligned header slot (actions, chips). */
  accessory?: ReactNode;
}

/** Sectioned surface region — used by the right context panel and settings groups. */
export function Panel({ title, accessory, className, children, ...rest }: PanelProps) {
  return (
    <section className={cn('rounded-[14px] bg-surface-1 hairline', className)} {...rest}>
      {(title || accessory) && (
        <header className="flex h-10 items-center justify-between border-b border-line px-4">
          {title && (
            <h3 className="text-label font-medium tracking-[0.02em] text-muted uppercase">
              {title}
            </h3>
          )}
          {accessory}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
