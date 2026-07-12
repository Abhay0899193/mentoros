import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { TitleBar } from './TitleBar';
import { Rail } from './Rail';
import { BottomTabs } from './BottomTabs';
import { MoreSheet } from './MoreSheet';
import { ContextPanel } from './ContextPanel';
import { CommandPalette } from './CommandPalette';
import { Toaster } from '../../ui';
import { useShell, MODULES } from '../../lib/store';
import { useIsMobile, useIsCompact } from '../../lib/useBreakpoint';

/**
 * App shell (§4.0). Wide: rail · canvas · context panel. Phone: canvas with a
 * bottom tab bar, the rail's destinations moving into the "More" sheet and the
 * context panel becoming a drawer — three fixed columns cannot share 390px.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { setActive, setPaletteOpen, paletteOpen, setContextPanelOpen } = useShell();
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();

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

  // Narrowing past lg turns the panel into an overlay drawer; leaving it open
  // across that boundary would slam a drawer over the screen on resize.
  useEffect(() => {
    if (isCompact) setContextPanelOpen(false);
  }, [isCompact, setContextPanelOpen]);

  const immersive = useShell((s) => s.active === 'voice');

  // h-dvh, not h-screen: iOS Safari's vh includes the URL bar, so h-screen
  // pushes the tab bar under the fold until the user scrolls.
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {!isMobile && (
          /* Voice Mode dims the chrome so nothing competes with the Orb (§4.3).
             Never on touch — "hover to bring it back" has no gesture there. */
          <div
            className={cn(
              'flex shrink-0 transition-opacity duration-500',
              immersive && 'opacity-35 hover:opacity-100',
            )}
          >
            <Rail />
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        {!immersive && <ContextPanel />}
      </div>
      {isMobile && <BottomTabs />}
      {isMobile && <MoreSheet />}
      <CommandPalette />
      <Toaster />
    </div>
  );
}
