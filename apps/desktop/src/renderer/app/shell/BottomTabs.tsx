import { motion, useReducedMotion } from 'motion/react';
import { Ellipsis } from 'lucide-react';
import { spring, dur } from '../../motion/springs';
import { cn } from '../../lib/cn';
import { useShell, MODULES, PRIMARY_TAB_IDS, type ModuleMeta } from '../../lib/store';

function Tab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: ModuleMeta['icon'] | typeof Ellipsis;
  active: boolean;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[10px] pt-2 pb-1.5',
        'tap-target text-faint transition-colors',
        active && 'text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-indicator"
          transition={reduce ? { duration: dur.micro } : spring.smooth}
          className="aurora-bg absolute top-0 h-[2px] w-8 rounded-full"
        />
      )}
      <Icon size={22} strokeWidth={1.5} />
      <span className="text-[11px] leading-none font-medium">{label}</span>
    </button>
  );
}

/**
 * Phone navigation (< md). Replaces the Rail, which cannot fit: the three hero
 * destinations sit in the thumb zone and the other nine live behind "More".
 * Padded past the home indicator so the last row of any screen stays tappable.
 */
export function BottomTabs() {
  const { active, setActive, moreSheetOpen, setMoreSheetOpen } = useShell();

  const primary = PRIMARY_TAB_IDS.map((id) => MODULES.find((m) => m.id === id)!).filter(Boolean);
  // "More" reads as selected whenever the open screen isn't one of the three.
  const moreActive = moreSheetOpen || !PRIMARY_TAB_IDS.includes(active);

  return (
    <nav
      aria-label="Modules"
      className="pb-safe flex shrink-0 items-stretch gap-1 border-t border-line bg-surface-1 px-2 pt-0.5"
    >
      {primary.map((m) => (
        <Tab
          key={m.id}
          label={m.label}
          icon={m.icon}
          active={!moreSheetOpen && active === m.id}
          onClick={() => setActive(m.id)}
        />
      ))}
      <Tab
        label="More"
        icon={Ellipsis}
        active={moreActive}
        onClick={() => setMoreSheetOpen(!moreSheetOpen)}
      />
    </nav>
  );
}
