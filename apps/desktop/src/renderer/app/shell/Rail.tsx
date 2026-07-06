import { motion, useReducedMotion } from 'motion/react';
import { Settings, Moon, Sun, PanelLeft } from 'lucide-react';
import { spring, dur } from '../../motion/springs';
import { cn } from '../../lib/cn';
import { useShell, MODULES, DESIGN_MODULE, type ModuleMeta } from '../../lib/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Keycap } from '../../ui';

function RailItem({ meta, expanded }: { meta: ModuleMeta; expanded: boolean }) {
  const { active, setActive } = useShell();
  const isActive = active === meta.id;
  const Icon = meta.icon;

  return (
    <button
      onClick={() => setActive(meta.id)}
      aria-label={meta.label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex h-10 w-full items-center gap-3 rounded-[10px] px-[11px]',
        'text-muted hover:bg-surface-2 hover:text-body',
        isActive && 'bg-surface-2 text-ink',
      )}
    >
      {isActive && (
        <motion.span
          layoutId="rail-indicator"
          transition={spring.smooth}
          className="aurora-bg absolute top-2 bottom-2 -left-2 w-[3px] rounded-full"
        />
      )}
      <Icon size={20} strokeWidth={1.5} className="shrink-0" />
      {expanded && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.base, delay: 0.05 } }}
          className="flex-1 truncate text-left text-small"
        >
          {meta.label}
        </motion.span>
      )}
      {expanded && meta.shortcut && (
        <span className="flex gap-0.5 opacity-60">
          <Keycap>⌘</Keycap>
          <Keycap>{meta.shortcut}</Keycap>
        </span>
      )}
    </button>
  );
}

/** Left rail (§4.0): 64→240px, Aurora indicator glides between items. */
export function Rail() {
  const { railExpanded, toggleRail, active, setActive } = useShell();
  const { theme, toggle: toggleTheme } = useTheme();
  const reduce = useReducedMotion();

  return (
    <motion.nav
      aria-label="Modules"
      animate={{ width: railExpanded ? 240 : 64 }}
      transition={reduce ? { duration: dur.micro } : spring.smooth}
      className="flex shrink-0 flex-col border-r border-line bg-surface-1 px-3 pt-2 pb-3"
    >
      <div className="flex flex-1 flex-col gap-0.5">
        {MODULES.map((m) => (
          <RailItem key={m.id} meta={m} expanded={railExpanded} />
        ))}
        <div className="mx-1 my-2 border-t border-line" />
        <RailItem meta={DESIGN_MODULE} expanded={railExpanded} />
      </div>

      <div className="flex flex-col gap-0.5">
        <button
          onClick={toggleRail}
          aria-label={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="flex h-10 w-full items-center gap-3 rounded-[10px] px-[11px] text-faint hover:bg-surface-2 hover:text-body"
        >
          <PanelLeft size={20} strokeWidth={1.5} className="shrink-0" />
          {railExpanded && <span className="text-small">Collapse</span>}
        </button>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-10 w-full items-center gap-3 rounded-[10px] px-[11px] text-faint hover:bg-surface-2 hover:text-body"
        >
          {theme === 'dark' ? (
            <Sun size={20} strokeWidth={1.5} className="shrink-0" />
          ) : (
            <Moon size={20} strokeWidth={1.5} className="shrink-0" />
          )}
          {railExpanded && <span className="text-small">{theme === 'dark' ? 'Light' : 'Dark'} theme</span>}
        </button>
        <button
          onClick={() => setActive('settings')}
          aria-label="Settings"
          aria-current={active === 'settings' ? 'page' : undefined}
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-[10px] px-[11px] text-faint hover:bg-surface-2 hover:text-body',
            active === 'settings' && 'bg-surface-2 text-ink',
          )}
        >
          <Settings size={20} strokeWidth={1.5} className="shrink-0" />
          {railExpanded && <span className="flex-1 text-left text-small">Settings</span>}
          {/* Sync status: local-only for now — quiet dot, no color (not a status alert) */}
          <span title="Local only — nothing syncs" className="size-1.5 rounded-full bg-faint" />
        </button>
      </div>
    </motion.nav>
  );
}
