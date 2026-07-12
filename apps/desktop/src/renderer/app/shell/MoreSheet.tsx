import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Settings, Moon, Sun } from 'lucide-react';
import { spring, dur } from '../../motion/springs';
import { cn } from '../../lib/cn';
import {
  useShell,
  MODULES,
  PRIMARY_TAB_IDS,
  DESIGN_MODULE,
  STUDIO_MODULE,
  type ModuleMeta,
  type ModuleId,
} from '../../lib/store';
import { useTheme } from '../../theme/ThemeProvider';

function Destination({ meta, active, onSelect }: { meta: ModuleMeta; active: boolean; onSelect: () => void }) {
  const Icon = meta.icon;
  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-[76px] flex-col items-start justify-center gap-2 rounded-[14px] p-3',
        'bg-surface-2 text-muted hairline',
        active && 'bg-surface-3 text-ink',
      )}
    >
      <Icon size={20} strokeWidth={1.5} />
      <span className="text-small font-medium">{meta.label}</span>
    </button>
  );
}

/**
 * The other nine destinations (< md). A bottom sheet rather than a full screen:
 * it reads as a detour from the current screen, not a place you navigate to.
 * Dismiss by tapping the scrim or flicking it down.
 */
export function MoreSheet() {
  const { active, setActive, moreSheetOpen, setMoreSheetOpen } = useShell();
  const { theme, toggle: toggleTheme } = useTheme();
  const reduce = useReducedMotion();

  const secondary: ModuleMeta[] = [
    ...MODULES.filter((m) => !PRIMARY_TAB_IDS.includes(m.id)),
    STUDIO_MODULE,
    DESIGN_MODULE,
  ];

  const close = () => setMoreSheetOpen(false);
  const go = (id: ModuleId) => setActive(id);

  return (
    <AnimatePresence>
      {moreSheetOpen && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.micro }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="All modules"
            className="pb-safe-plus-4 max-h-[80dvh] w-full overflow-y-auto rounded-t-[20px] border-t border-line bg-surface-1 px-4 pt-2"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? { duration: dur.micro } : spring.smooth}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) close();
            }}
          >
            {/* Grab handle — the affordance for the flick-down dismiss */}
            <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-line-strong" />

            <div className="grid grid-cols-3 gap-2">
              {secondary.map((m) => (
                <Destination key={m.id} meta={m} active={active === m.id} onSelect={() => go(m.id)} />
              ))}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => go('settings')}
                aria-current={active === 'settings' ? 'page' : undefined}
                className={cn(
                  'flex min-h-[52px] items-center gap-3 rounded-[14px] bg-surface-2 px-3 text-muted hairline',
                  active === 'settings' && 'bg-surface-3 text-ink',
                )}
              >
                <Settings size={20} strokeWidth={1.5} />
                <span className="text-small font-medium">Settings</span>
              </button>
              <button
                onClick={toggleTheme}
                className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-surface-2 px-3 text-muted hairline"
              >
                {theme === 'dark' ? (
                  <Sun size={20} strokeWidth={1.5} />
                ) : (
                  <Moon size={20} strokeWidth={1.5} />
                )}
                <span className="text-small font-medium">
                  {theme === 'dark' ? 'Light' : 'Dark'} theme
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
