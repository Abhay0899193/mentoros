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

interface ShellStore {
  active: ModuleId;
  railExpanded: boolean;
  paletteOpen: boolean;
  contextPanelOpen: boolean;
  setActive: (m: ModuleId) => void;
  toggleRail: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleContextPanel: () => void;
}

export const useShell = create<ShellStore>((set) => ({
  active: 'design',
  railExpanded: false,
  paletteOpen: false,
  contextPanelOpen: true,
  setActive: (m) => set({ active: m, paletteOpen: false }),
  toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
}));
