import type { FacePresetId } from '../../lib/coreClient';

import lenaBase from './art/lena/portrait-base.webp';
import lenaM1 from './art/lena/portrait-m1.webp';
import lenaM2 from './art/lena/portrait-m2.webp';
import lenaM3 from './art/lena/portrait-m3.webp';
import lenaBlink from './art/lena/portrait-blink.webp';
import lenaFull from './art/lena/full.webp';
import siennaBase from './art/sienna/portrait-base.webp';
import siennaM1 from './art/sienna/portrait-m1.webp';
import siennaM2 from './art/sienna/portrait-m2.webp';
import siennaM3 from './art/sienna/portrait-m3.webp';
import siennaBlink from './art/sienna/portrait-blink.webp';
import siennaFull from './art/sienna/full.webp';
import kiraBase from './art/kira/portrait-base.webp';
import kiraM1 from './art/kira/portrait-m1.webp';
import kiraM2 from './art/kira/portrait-m2.webp';
import kiraM3 from './art/kira/portrait-m3.webp';
import kiraBlink from './art/kira/portrait-blink.webp';
import kiraFull from './art/kira/full.webp';

/**
 * Realistic face presets — pre-generated stills (FLUX, generated once by the
 * asset pipeline in tools/faces/) played back as a sprite stack:
 * base + three mouth apertures + a blink frame, all pixel-aligned full frames
 * so lip-sync is just opacity switching. Unlike the stylized presets these do
 * not morph with glam/maturity — each preset IS a fixed look; they also ship
 * a full-body still for the 'full' faceView.
 */

export type RealisticPresetId = Extract<FacePresetId, 'lena' | 'sienna' | 'kira'>;

/**
 * User-created presets (Settings → Identity → New preset) satisfy this same
 * shape — their art is served by core from userData instead of being bundled,
 * and faceStore adapts them so the player/gallery treat both alike.
 */

export interface RealisticSprites {
  /** Mouth closed, eyes open — the resting frame, always painted. */
  base: string;
  /** Lips parted a touch. */
  mouthSmall: string;
  /** Mid speech aperture. */
  mouthOpen: string;
  /** Wide/emphatic aperture. */
  mouthWide: string;
  /** Eyes closed (blink frame). */
  blink: string;
}

export interface RealisticPreset {
  id: FacePresetId;
  name: string;
  /** True for user-created presets (deletable; art served by core). */
  custom?: boolean;
  /** One-line personality for the gallery card. */
  vibe: string;
  /** Accent sampled from the artwork; tints the ambient aura. */
  accent: string;
  portrait: RealisticSprites;
  /** Full-body still (2:3), used when faceView is 'full'. */
  full: string;
}

export const REALISTIC_PRESETS: RealisticPreset[] = [
  {
    id: 'lena',
    name: 'Lena',
    vibe: 'Soft honey waves, an easy off-duty warmth.',
    accent: '#C99A6B',
    portrait: { base: lenaBase, mouthSmall: lenaM1, mouthOpen: lenaM2, mouthWide: lenaM3, blink: lenaBlink },
    full: lenaFull,
  },
  {
    id: 'sienna',
    name: 'Sienna',
    vibe: 'Dark waves, tailored lines, quietly magnetic.',
    accent: '#A0685A',
    portrait: { base: siennaBase, mouthSmall: siennaM1, mouthOpen: siennaM2, mouthWide: siennaM3, blink: siennaBlink },
    full: siennaFull,
  },
  {
    id: 'kira',
    name: 'Kira',
    vibe: 'Editorial polish, evening-light glamour.',
    accent: '#B4788C',
    portrait: { base: kiraBase, mouthSmall: kiraM1, mouthOpen: kiraM2, mouthWide: kiraM3, blink: kiraBlink },
    full: kiraFull,
  },
];

export const REALISTIC_PRESET_MAP: Partial<Record<string, RealisticPreset>> = Object.fromEntries(
  REALISTIC_PRESETS.map((p) => [p.id, p]),
);
