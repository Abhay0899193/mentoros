import type { LucideIcon } from 'lucide-react';
import { FileText, FileCode, File, Folder } from 'lucide-react';
import type { KbKind } from '../../../lib/coreClient';

export const KIND_ICON: Record<KbKind, LucideIcon> = {
  pdf: FileText,
  md: FileCode,
  txt: File,
  folder: Folder,
};

type Tone = 'danger' | 'info' | 'success' | 'warning';

/**
 * Category glyph tone (§3.0.2) — saturated color lives only inside the
 * glyph tile, never on generic chrome.
 */
export const KIND_TONE: Record<KbKind, Tone> = {
  pdf: 'danger',
  md: 'info',
  txt: 'success',
  folder: 'warning',
};

const TONE_CLASSES: Record<Tone, string> = {
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
};

export function kindGlyphClasses(kind: KbKind): string {
  return TONE_CLASSES[KIND_TONE[kind]];
}

export const KIND_LABEL: Record<KbKind, string> = {
  pdf: 'PDF',
  md: 'Markdown',
  txt: 'Text',
  folder: 'Folder',
};
