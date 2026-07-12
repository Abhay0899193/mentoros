import { Search, PanelRight } from 'lucide-react';
import { useShell } from '../../lib/store';
import { Keycap } from '../../ui';

/**
 * Frameless drag bar with the ⌘K pill (§4.0). Traffic lights sit at 16,16.
 * On a phone the pill stretches to fill the row (no traffic lights to clear,
 * and a fixed 288px pill would crowd out the panel toggle), and the bar is
 * padded below the status bar / notch.
 */
export function TitleBar() {
  const { setPaletteOpen, toggleContextPanel } = useShell();

  return (
    <header className="drag-region pt-safe px-safe shrink-0 border-b border-line bg-surface-1">
      <div className="relative flex h-12 items-center justify-center gap-2 px-3 md:h-11">
        <button
          onClick={() => setPaletteOpen(true)}
          className="no-drag flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 hairline px-3 text-small text-faint hover:bg-surface-3 hover:text-muted md:h-7 md:w-72 md:flex-none"
        >
          <Search size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="flex-1 truncate text-left">Search or jump to…</span>
          {/* The keycap hint is a lie on a touch device — there is no ⌘ key */}
          <span className="hidden gap-0.5 fine:flex">
            <Keycap>⌘</Keycap>
            <Keycap>K</Keycap>
          </span>
        </button>
        <button
          onClick={toggleContextPanel}
          aria-label="Toggle context panel"
          className="no-drag tap-target flex shrink-0 items-center justify-center rounded-[8px] p-1.5 text-faint hover:bg-surface-2 hover:text-body md:absolute md:right-3"
        >
          <PanelRight size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
