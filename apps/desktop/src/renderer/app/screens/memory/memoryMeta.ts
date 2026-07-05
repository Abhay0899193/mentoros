import type { LucideIcon } from 'lucide-react';
import {
  Target,
  AlertTriangle,
  Wrench,
  BookOpen,
  GraduationCap,
  FolderKanban,
  TrendingUp,
  User,
  Heart,
  Trophy,
  FolderGit2,
  Users,
  FlaskConical,
} from 'lucide-react';
import type { MemoryType } from '../../../lib/coreClient';

/**
 * Memory-type categorical palette — validated with the dataviz six-checks
 * (dark #0A0B0F PASS; light #F7F8FA PASS with contrast WARN on green/teal,
 * relieved by: labeled legend, tooltips naming the type, and the list view).
 * Fixed assignment order; long-tail types fold to neutral. Never re-map.
 */
export const TYPE_COLOR: Record<MemoryType, string> = {
  goal: '#7C7CFF',
  mistake: '#E15656',
  skill: '#3991D3',
  book: '#B8802A',
  learning: '#2DA379',
  project: '#A66BFF',
  career: '#2A9EAD',
  // long tail — neutral fold ("Other" tone; identity comes from label/tooltip)
  identity: '#8A909E',
  preference: '#8A909E',
  achievement: '#8A909E',
  repo: '#8A909E',
  meeting: '#8A909E',
  research: '#8A909E',
};

export const TYPE_ICON: Record<MemoryType, LucideIcon> = {
  goal: Target,
  mistake: AlertTriangle,
  skill: Wrench,
  book: BookOpen,
  learning: GraduationCap,
  project: FolderKanban,
  career: TrendingUp,
  identity: User,
  preference: Heart,
  achievement: Trophy,
  repo: FolderGit2,
  meeting: Users,
  research: FlaskConical,
};

/** Legend/display order — the 7 colored types first, then the neutral fold. */
export const TYPE_ORDER: MemoryType[] = [
  'goal',
  'mistake',
  'skill',
  'book',
  'learning',
  'project',
  'career',
  'identity',
  'preference',
  'achievement',
  'repo',
  'meeting',
  'research',
];

export const typeLabel = (t: MemoryType): string => t.charAt(0).toUpperCase() + t.slice(1);
