import { motion } from 'motion/react';
import { spring } from '../motion/springs';
import { cn } from '../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}

/** Monochrome toggle — the only color is the iris fill when on (§3.0.2). */
export function Switch({ checked, onChange, disabled, label, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-default items-center rounded-full transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        checked ? 'bg-iris/70' : 'bg-surface-3 hairline',
      )}
    >
      <motion.span
        layout
        transition={spring.snappy}
        className={cn('block size-4.5 rounded-full bg-canvas', checked ? 'ml-[19px]' : 'ml-0.5')}
      />
    </button>
  );
}
