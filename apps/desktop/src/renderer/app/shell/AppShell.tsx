import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { TitleBar } from './TitleBar';
import { Rail } from './Rail';
import { ContextPanel } from './ContextPanel';
import { CommandPalette } from './CommandPalette';
import { Toaster } from '../../ui';
import { useShell, MODULES } from '../../lib/store';

/** App shell (§4.0): rail · canvas · context panel, palette over all. */
export function AppShell({ children }: { children: ReactNode }) {
  const { setActive, setPaletteOpen, paletteOpen } = useShell();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      const mod = MODULES.find((m) => m.shortcut === e.key);
      if (mod) {
        e.preventDefault();
        setActive(mod.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setActive, setPaletteOpen]);

  const immersive = useShell((s) => s.active === 'voice');

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {/* Voice Mode dims the chrome so nothing competes with the Orb (§4.3) */}
        <div
          className={cn(
            'flex shrink-0 transition-opacity duration-500',
            immersive && 'opacity-35 hover:opacity-100',
          )}
        >
          <Rail />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        {!immersive && <ContextPanel />}
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
