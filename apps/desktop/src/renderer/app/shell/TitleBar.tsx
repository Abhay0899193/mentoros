import { Search, PanelRight } from 'lucide-react';
import { useShell } from '../../lib/store';
import { Keycap } from '../../ui';

/** Frameless drag bar with the ⌘K pill (§4.0). Traffic lights sit at 16,16. */
export function TitleBar() {
  const { setPaletteOpen, toggleContextPanel } = useShell();

  return (
    <header className="drag-region relative flex h-11 shrink-0 items-center justify-center border-b border-line bg-surface-1">
      <button
        onClick={() => setPaletteOpen(true)}
        className="no-drag flex h-7 w-72 items-center gap-2 rounded-full bg-surface-2 hairline px-3 text-small text-faint hover:bg-surface-3 hover:text-muted"
      >
        <Search size={14} strokeWidth={1.5} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <span className="flex gap-0.5">
          <Keycap>⌘</Keycap>
          <Keycap>K</Keycap>
        </span>
      </button>
      <button
        onClick={toggleContextPanel}
        aria-label="Toggle context panel"
        className="no-drag absolute right-3 rounded-[8px] p-1.5 text-faint hover:bg-surface-2 hover:text-body"
      >
        <PanelRight size={16} strokeWidth={1.5} />
      </button>
    </header>
  );
}
