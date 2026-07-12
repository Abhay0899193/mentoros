import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import {
  House,
  MessageSquare,
  AudioLines,
  Brain,
  Target,
  GraduationCap,
  Library,
  FolderGit2,
  TrendingUp,
  Palette,
  Clapperboard,
} from 'lucide-react';

export type ModuleId =
  | 'home'
  | 'chat'
  | 'voice'
  | 'memory'
  | 'interview'
  | 'learning'
  | 'knowledge'
  | 'codebase'
  | 'career'
  | 'design'
  | 'studio'
  | 'settings';

export interface ModuleMeta {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  /** ⌘<shortcut> switches to the module (§4.0). */
  shortcut?: string;
}

export const MODULES: ModuleMeta[] = [
  { id: 'home', label: 'Home', icon: House, shortcut: '1' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, shortcut: '2' },
  { id: 'voice', label: 'Voice', icon: AudioLines, shortcut: '3' },
  { id: 'memory', label: 'Memory', icon: Brain, shortcut: '4' },
  { id: 'interview', label: 'Interview', icon: Target, shortcut: '5' },
  { id: 'learning', label: 'Learning', icon: GraduationCap, shortcut: '6' },
  { id: 'knowledge', label: 'Knowledge', icon: Library, shortcut: '7' },
  { id: 'codebase', label: 'Codebase', icon: FolderGit2, shortcut: '8' },
  { id: 'career', label: 'Career', icon: TrendingUp, shortcut: '9' },
];

/** Dev-only rail entry while the design system is under construction. */
export const DESIGN_MODULE: ModuleMeta = { id: 'design', label: 'Design', icon: Palette };

/** Avatar Studio — create/animate mentor avatars (first-class, below the modules). */
export const STUDIO_MODULE: ModuleMeta = { id: 'studio', label: 'Avatar Studio', icon: Clapperboard };

/** Phone tab bar: the three hero destinations; everything else lives in "More". */
export const PRIMARY_TAB_IDS: ModuleId[] = ['home', 'chat', 'voice'];

interface ShellStore {
  active: ModuleId;
  railExpanded: boolean;
  paletteOpen: boolean;
  contextPanelOpen: boolean;
  /** Phone-only: the "More" destination sheet. */
  moreSheetOpen: boolean;
  setActive: (m: ModuleId) => void;
  toggleRail: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleContextPanel: () => void;
  setContextPanelOpen: (open: boolean) => void;
  setMoreSheetOpen: (open: boolean) => void;
}

export const useShell = create<ShellStore>((set) => ({
  active: 'design',
  railExpanded: false,
  paletteOpen: false,
  // The panel is a third column on a wide screen but a drawer on a narrow one;
  // starting it open on a phone would greet the user with a drawer.
  contextPanelOpen: typeof window === 'undefined' || window.innerWidth >= 1024,
  moreSheetOpen: false,
  setActive: (m) => set({ active: m, paletteOpen: false, moreSheetOpen: false }),
  toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
  setMoreSheetOpen: (open) => set({ moreSheetOpen: open }),
}));
