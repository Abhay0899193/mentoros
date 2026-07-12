import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'motion/react';
import { spring } from '../motion/springs';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Short status shown while loading (never a silent spinner). */
  loadingLabel?: string;
  icon?: ReactNode;
  children?: ReactNode;
}

/* Monochrome chrome (§3.0.2): buttons are neutral. Color never appears
   on a generic button — danger is reserved for destructive actions. */
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-canvas hover:opacity-90',
  secondary: 'bg-surface-2 text-ink hairline hover:bg-surface-3',
  ghost: 'bg-transparent text-body hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger/10 text-danger hairline hover:bg-danger/15',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-small gap-1.5',
  md: 'h-9 px-4 text-small font-medium gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, loadingLabel, icon, className, disabled, children, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileHover={isDisabled ? undefined : { scale: 1.02 }}
      whileTap={isDisabled ? undefined : { scale: 0.98 }}
      transition={spring.snappy}
      className={cn(
        'inline-flex cursor-default items-center justify-center rounded-[10px] select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        // Mouse-sized (h-8/h-9) is under the 44px touch floor — grow on a finger.
        'tap-target',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={isDisabled}
      {...(rest as object)}
    >
      {loading ? (
        <>
          <Spinner className={variant === 'primary' ? 'border-canvas/30 border-t-canvas' : undefined} />
          {loadingLabel ?? children}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </motion.button>
  );
});
