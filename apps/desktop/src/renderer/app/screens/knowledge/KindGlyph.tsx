import { cn } from '../../../lib/cn';
import type { KbKind } from '../../../lib/coreClient';
import { KIND_ICON, kindGlyphClasses } from './kbMeta';

const SIZES = {
  sm: { box: 'size-7', icon: 14 },
  md: { box: 'size-9', icon: 18 },
  lg: { box: 'size-12', icon: 22 },
} as const;

export function KindGlyph({ kind, size = 'md' }: { kind: KbKind; size?: keyof typeof SIZES }) {
  const Icon = KIND_ICON[kind];
  const { box, icon } = SIZES[size];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[10px]',
        box,
        kindGlyphClasses(kind),
      )}
    >
      <Icon size={icon} strokeWidth={1.5} />
    </span>
  );
}
