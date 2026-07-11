import { Check, Moon, Sun } from 'lucide-react';
import { Panel } from '../../../ui';
import { cn } from '../../../lib/cn';
import { useTheme, ACCENTS, type Theme } from '../../../theme/ThemeProvider';

const MODES: Array<{ id: Theme; label: string; icon: typeof Moon }> = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
];

/** Appearance: color mode + accent theme (recolors the Orb/focal accent only —
    chrome stays monochrome per the design invariants). */
export function AppearanceSection() {
  const { theme, accent, setTheme, setAccent } = useTheme();

  return (
    <Panel title="Appearance">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-small text-ink">Color mode</p>
            <p className="text-label text-muted">Dark is the native look; light follows the same ladder.</p>
          </div>
          <div role="radiogroup" aria-label="Color mode" className="flex gap-1 rounded-[10px] bg-surface-2 p-1 hairline">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={theme === id}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-small transition-colors duration-150',
                  theme === id ? 'bg-surface-1 text-ink hairline' : 'text-muted hover:text-body',
                )}
              >
                <Icon size={13} strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-small text-ink">Accent theme</p>
          <p className="text-label text-muted">
            Recolors the Orb, focus rings, and active states — chrome stays monochrome.
          </p>
          <div role="radiogroup" aria-label="Accent theme" className="mt-2.5 flex flex-wrap gap-2">
            {ACCENTS.map((a) => {
              const selected = accent === a.id;
              return (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-small transition-colors duration-150 hairline',
                    selected ? 'bg-surface-2 text-ink ring-1 ring-iris/40' : 'bg-surface-1 text-muted hover:bg-surface-2 hover:text-body',
                  )}
                >
                  <span
                    aria-hidden
                    className="relative flex size-5 items-center justify-center rounded-full"
                    style={{ background: a.swatch }}
                  >
                    {selected && <Check size={11} strokeWidth={2.5} className="text-white drop-shadow" />}
                  </span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
