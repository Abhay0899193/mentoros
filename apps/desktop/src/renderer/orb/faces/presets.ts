import type { FaceGlam, FaceMaturity, FacePresetId } from '../../lib/coreClient';

/**
 * Face gallery presets — OWNED BY THE LEAD AGENT (hero visual).
 *
 * Each preset is pure data: a palette, facial geometry in a 200×200 design
 * space, and hair silhouettes. One renderer (`FacePortrait`) draws them all,
 * so every face inherits the same living choreography (blink/gaze/lip-sync)
 * and the same state-hue rim light for free. Two style dimensions morph any
 * preset live:
 *   glam     — natural → polished → glam (liner, lashes, lip color, jewelry)
 *   maturity — youthful → balanced → mature (contour, eye scale, softness)
 */

export interface FacePalette {
  skin: string;
  skinShade: string;
  skinLight: string;
  hair: string;
  hairShine: string;
  hairDeep: string;
  iris: string;
  irisEdge: string;
  brow: string;
  lipNatural: string;
  lipColor: string;
  blush: string;
  shadowTint: string;
  garment: string;
}

/** Facial geometry in the 200×200 design space (face centered on x=100). */
export interface FaceGeometry {
  templeW: number; // half-width at the temples (~y 66)
  cheekW: number; // half-width at the cheekbones (~y 100)
  jawW: number; // half-width where the jaw turns (~y 128)
  chinY: number; // bottom of the chin
  eyeDX: number; // eye center offset from x=100
  eyeY: number;
  eyeW: number; // eye half-width
  eyeH: number; // open aperture (half-height)
  eyeTilt: number; // deg; positive = outer corners lifted
  browY: number;
  browArch: number; // 0..1
  browThick: number;
  noseW: number; // nostril half-spread
  lipY: number;
  lipW: number; // half-width
  lipUpper: number; // upper lip thickness
  lipLower: number; // lower lip thickness
}

export type EarringStyle = 'stud' | 'drop' | 'hoop';

export interface FacePreset {
  id: Exclude<FacePresetId, 'aura'>;
  name: string;
  /** One-line personality for the gallery card. */
  vibe: string;
  palette: FacePalette;
  geometry: FaceGeometry;
  /** Filled silhouette behind the head (crown + lengths). */
  hairBack: string;
  /** Filled shape over the forehead/temples whose inner edge is the hairline. */
  hairFront: string;
  /** Optional glossy streak paths drawn inside hairFront. */
  hairShinePaths?: string[];
  earring: EarringStyle;
  freckles?: Array<[number, number]>;
  beautyMark?: [number, number];
}

export const BASE_GEOMETRY: FaceGeometry = {
  templeW: 33,
  cheekW: 34.5,
  jawW: 26,
  chinY: 152,
  eyeDX: 21,
  eyeY: 95,
  eyeW: 11,
  eyeH: 7.4,
  eyeTilt: 2,
  browY: 82,
  browArch: 0.55,
  browThick: 2.6,
  noseW: 6.6,
  lipY: 135,
  lipW: 13.5,
  lipUpper: 3.4,
  lipLower: 5.2,
};

/* ------------------------------ style morphs ----------------------------- */

export interface ResolvedStyle {
  /** Geometry after the maturity morph. */
  geo: FaceGeometry;
  /** 0..1 shading strengths. */
  contour: number;
  nasolabial: number;
  lidCrease: number;
  blushK: number;
  irisScale: number;
  /** Glam paint. */
  linerW: number;
  wing: number; // 0..1
  lashes: boolean;
  lowerLiner: boolean;
  eyeshadow: number; // opacity
  lip: string;
  lipGloss: number; // opacity
  highlight: number; // cheekbone highlight opacity
  earrings: 'none' | EarringStyle;
  browDefine: number; // extra brow opacity/weight
}

/** Linear-interpolate two hex colors (no alpha). */
export function hexMix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 0xff;
    const vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function resolveStyle(
  preset: FacePreset,
  glam: FaceGlam,
  maturity: FaceMaturity,
): ResolvedStyle {
  const g = preset.geometry;
  // Maturity: youthful = fuller/rounder + larger iris; mature = defined planes.
  const m = maturity === 'youthful' ? -1 : maturity === 'mature' ? 1 : 0;
  const geo: FaceGeometry = {
    ...g,
    cheekW: g.cheekW - m * 1.2,
    jawW: g.jawW - m * 1.4,
    eyeH: g.eyeH - m * 0.4,
    browY: g.browY + m * 0.8,
    lipLower: g.lipLower - m * 0.4,
  };

  const p = preset.palette;
  const base: ResolvedStyle = {
    geo,
    contour: m === -1 ? 0.0 : m === 0 ? 0.3 : 0.62,
    nasolabial: m === 1 ? 0.3 : 0,
    lidCrease: m === -1 ? 0.06 : m === 0 ? 0.1 : 0.18,
    blushK: m === -1 ? 1.15 : m === 0 ? 1 : 0.8,
    irisScale: m === -1 ? 1.08 : m === 0 ? 1 : 0.94,
    linerW: 0,
    wing: 0,
    lashes: false,
    lowerLiner: false,
    eyeshadow: 0,
    lip: hexMix(p.skin, p.lipNatural, 0.8),
    lipGloss: 0,
    highlight: 0,
    earrings: 'none',
    browDefine: 0,
  };

  if (glam === 'natural') return base;
  if (glam === 'polished') {
    return {
      ...base,
      linerW: 1.3,
      wing: 0.4,
      lashes: false,
      eyeshadow: 0.12,
      lip: hexMix(p.lipNatural, p.lipColor, 0.5),
      lipGloss: 0.14,
      blushK: base.blushK * 1.05,
      highlight: 0.1,
      earrings: 'stud',
      browDefine: 0.4,
    };
  }
  return {
    ...base,
    linerW: 2,
    wing: 1,
    lashes: true,
    lowerLiner: true,
    eyeshadow: 0.26,
    lip: p.lipColor,
    lipGloss: 0.3,
    blushK: base.blushK * 1.2,
    highlight: 0.22,
    earrings: preset.earring,
    browDefine: 0.75,
  };
}

/* ------------------------------ hair helpers ----------------------------- */

/** Scalloped near-circle (curl silhouettes) as a closed path. */
function scallopCircle(cx: number, cy: number, r: number, bumps: number, amp: number): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < bumps; i++) {
    const [x2, y2] = pts[(i + 1) % bumps];
    const [x1, y1] = pts[i];
    const midA = ((i + 0.5) / bumps) * Math.PI * 2 - Math.PI / 2;
    const mx = cx + Math.cos(midA) * (r + amp);
    const my = cy + Math.sin(midA) * (r + amp);
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${((x1 + x2) / 2 + (x2 - x1) / 2).toFixed(1)} ${((y1 + y2) / 2 + (y2 - y1) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

/* -------------------------------- presets -------------------------------- */

export const FACE_PRESETS: FacePreset[] = [
  {
    id: 'nova',
    name: 'Nova',
    vibe: 'Copper waves, green eyes, a spray of freckles.',
    palette: {
      skin: '#F0C5A5',
      skinShade: '#D49B78',
      skinLight: '#FBE2CB',
      hair: '#9C4A24',
      hairShine: '#CE7B42',
      hairDeep: '#67300F',
      iris: '#5B8F6B',
      irisEdge: '#2E4F3A',
      brow: '#6E3E1E',
      lipNatural: '#C97B6C',
      lipColor: '#B2404C',
      blush: '#E58A78',
      shadowTint: '#A66A55',
      garment: '#20222E',
    },
    geometry: { ...BASE_GEOMETRY, browArch: 0.62, eyeTilt: 2.5 },
    hairBack:
      'M 100 20 C 62 20 42 46 39 76 C 36 100 45 114 38 134 C 32 152 44 162 37 180 C 34 190 38 197 42 202 L 158 202 C 163 196 166 188 162 178 C 156 162 169 150 163 132 C 156 112 165 98 161 76 C 156 46 138 20 100 20 Z',
    hairFront:
      'M 100 24 C 66 24 48 48 50 82 C 51 94 55 104 60 110 C 58 96 58 84 63 74 C 66 66 71 60 78 56 C 74 64 72 72 73 80 C 78 66 88 56 103 53 C 120 55 132 64 137 78 C 140 68 145 62 152 60 C 149 76 152 90 148 106 C 153 98 156 90 156 80 C 158 48 134 24 100 24 Z',
    hairShinePaths: [
      'M 64 60 C 74 46 90 40 104 41 C 88 44 74 52 66 66 Z',
      'M 142 66 C 136 56 126 48 114 45 C 128 46 140 54 146 64 Z',
    ],
    earring: 'drop',
    freckles: [
      [82, 112],
      [88, 116],
      [94, 111],
      [78, 117],
      [106, 111],
      [112, 116],
      [118, 112],
      [122, 117],
      [100, 115],
    ],
  },
  {
    id: 'ivy',
    name: 'Ivy',
    vibe: 'Jet-black curtain bangs, calm dark eyes.',
    palette: {
      skin: '#F2D3B4',
      skinShade: '#D6AB82',
      skinLight: '#FCEBD3',
      hair: '#191B23',
      hairShine: '#3D4358',
      hairDeep: '#0B0C11',
      iris: '#4A342A',
      irisEdge: '#241610',
      brow: '#2A2118',
      lipNatural: '#C98274',
      lipColor: '#C1465A',
      blush: '#E79684',
      shadowTint: '#B07A62',
      garment: '#1B1D26',
    },
    geometry: {
      ...BASE_GEOMETRY,
      eyeTilt: 4.5,
      eyeH: 6.9,
      browArch: 0.3,
      browThick: 2.4,
      lipW: 12.8,
      lipUpper: 3.7,
    },
    hairBack:
      'M 100 21 C 60 21 41 48 40 80 C 39 110 42 136 41 166 C 40.5 180 42 192 45 202 L 155 202 C 158 192 159.5 180 159 166 C 158 136 161 110 160 80 C 159 48 140 21 100 21 Z',
    hairFront:
      'M 100 25 C 64 25 49 52 51 88 C 52 102 56 112 61 118 C 58 100 57 82 62 68 C 68 54 80 47 97 46 L 99 42 L 101 46 C 120 47 132 54 138 68 C 143 82 142 100 139 118 C 144 112 148 102 149 88 C 151 52 136 25 100 25 Z',
    hairShinePaths: ['M 58 74 C 62 56 76 46 92 44 C 76 50 66 60 62 76 Z'],
    earring: 'drop',
    beautyMark: [117, 124],
  },
  {
    id: 'zara',
    name: 'Zara',
    vibe: 'Crown of dark curls, gold at the ears.',
    palette: {
      skin: '#8A5535',
      skinShade: '#68391D',
      skinLight: '#AA7146',
      hair: '#181210',
      hairShine: '#4C382B',
      hairDeep: '#0A0705',
      iris: '#3A2418',
      irisEdge: '#1C0F08',
      brow: '#231710',
      lipNatural: '#9C5B4C',
      lipColor: '#A03A52',
      blush: '#B0604A',
      shadowTint: '#5E3823',
      garment: '#242031',
    },
    geometry: {
      ...BASE_GEOMETRY,
      cheekW: 36,
      jawW: 28,
      eyeH: 7.6,
      browArch: 0.7,
      lipW: 14.5,
      lipUpper: 4.4,
      lipLower: 6,
    },
    hairBack: scallopCircle(100, 74, 62, 16, 9),
    hairFront:
      'M 100 26 C 68 26 51 47 52 76 C 52.5 88 57 98 63 103 C 60 90 60 78 65 68 C 62 80 64 92 70 99 C 68 86 71 74 79 66 C 76 76 78 86 84 92 C 83 80 88 68 100 63 C 112 68 117 80 116 92 C 122 86 124 76 121 66 C 129 74 132 86 130 99 C 136 92 138 80 135 68 C 140 78 140 90 137 103 C 143 98 147.5 88 148 76 C 149 47 132 26 100 26 Z',
    earring: 'hoop',
  },
  {
    id: 'elle',
    name: 'Elle',
    vibe: 'Platinum bob, glacier-blue gaze.',
    palette: {
      skin: '#F4D6C1',
      skinShade: '#DCAE8C',
      skinLight: '#FDEEDD',
      hair: '#E6DCCB',
      hairShine: '#FAF5EA',
      hairDeep: '#BFB09A',
      iris: '#4C7FAF',
      irisEdge: '#28486B',
      brow: '#8A7358',
      lipNatural: '#D08A7B',
      lipColor: '#C64A5E',
      blush: '#EE9D89',
      shadowTint: '#BB8668',
      garment: '#26242C',
    },
    geometry: {
      ...BASE_GEOMETRY,
      cheekW: 33.5,
      jawW: 24.5,
      eyeH: 7.8,
      browArch: 0.5,
      browThick: 2.2,
      chinY: 153,
    },
    hairBack:
      'M 100 22 C 63 22 44 46 43 76 C 42 104 46 124 44 142 C 42.5 156 50 164 62 165 C 56 154 55 142 57 132 L 143 132 C 145 142 144 154 138 165 C 150 164 157.5 156 156 142 C 154 124 158 104 157 76 C 156 46 137 22 100 22 Z',
    hairFront:
      'M 100 26 C 66 26 50 50 52 84 C 53 96 57 106 63 112 C 60 94 61 76 70 64 C 78 53 90 48 106 48 C 94 54 86 62 82 74 C 92 60 108 53 126 56 C 136 60 143 70 146 84 C 148 96 146 106 141 112 C 146 106 149.5 96 149 84 C 148 50 134 26 100 26 Z',
    hairShinePaths: ['M 60 78 C 63 60 76 50 92 47 C 78 54 68 64 64 80 Z'],
    earring: 'drop',
    beautyMark: [83, 126],
  },
  {
    id: 'mira',
    name: 'Mira',
    vibe: 'Midnight waves tucked back, warm hazel eyes.',
    palette: {
      skin: '#BC8258',
      skinShade: '#96603A',
      skinLight: '#D9A272',
      hair: '#241813',
      hairShine: '#5C4028',
      hairDeep: '#120B08',
      iris: '#6E4A26',
      irisEdge: '#3A2410',
      brow: '#2E1D12',
      lipNatural: '#A86352',
      lipColor: '#AF3A4A',
      blush: '#CD7757',
      shadowTint: '#7A4A2C',
      garment: '#1E2029',
    },
    geometry: {
      ...BASE_GEOMETRY,
      eyeH: 8,
      eyeTilt: 3,
      browArch: 0.58,
      browThick: 3,
      lipW: 14,
      lipUpper: 4,
      lipLower: 5.6,
    },
    hairBack:
      'M 100 21 C 61 21 42 47 41 78 C 40 104 47 122 40 144 C 35 160 45 172 39 190 C 37 195 39 199 41 202 L 159 202 C 161 199 163 195 161 190 C 155 172 165 160 160 144 C 153 122 160 104 159 78 C 158 47 139 21 100 21 Z',
    hairFront:
      'M 100 25 C 65 25 49 51 51 86 C 52 96 55 104 59 109 C 57 92 58 74 66 62 C 74 51 86 46 98 45 L 100 41 L 102 45 C 114 46 126 51 134 62 C 142 74 143 92 141 109 C 145 104 148 96 149 86 C 151 51 135 25 100 25 Z',
    hairShinePaths: ['M 140 70 C 136 58 126 50 112 46 C 128 48 138 56 143 68 Z'],
    earring: 'hoop',
    beautyMark: [120, 122],
  },
  {
    id: 'rae',
    name: 'Rae',
    vibe: 'Silver-lavender lob, aurora-violet eyes.',
    palette: {
      skin: '#EFCDB6',
      skinShade: '#D2A17E',
      skinLight: '#FBE7D2',
      hair: '#B3A8CE',
      hairShine: '#E6DFF6',
      hairDeep: '#7A6FA0',
      iris: '#7C7CFF',
      irisEdge: '#4241A8',
      brow: '#5D5470',
      lipNatural: '#C57F74',
      lipColor: '#8E4A6E',
      blush: '#E19487',
      shadowTint: '#9C7A88',
      garment: '#221F2E',
    },
    geometry: {
      ...BASE_GEOMETRY,
      eyeTilt: 5,
      eyeH: 7,
      jawW: 25,
      browArch: 0.35,
      browThick: 2.3,
      lipW: 13,
    },
    hairBack:
      'M 100 22 C 62 22 43 47 42 78 C 41 106 45 128 43 150 C 41.5 164 47 174 57 177 C 52 166 51 152 53 140 L 147 140 C 149 152 148 166 143 177 C 153 174 158.5 164 157 150 C 155 128 159 106 158 78 C 157 47 138 22 100 22 Z',
    hairFront:
      'M 100 26 C 65 26 50 50 52 84 C 53 95 56 104 61 110 C 59 96 59 82 63 72 C 63 68 64 66 66 64 L 134 64 C 136 66 137 68 137 72 C 141 82 141 96 139 110 C 144 104 147 95 148 84 C 150 50 135 26 100 26 Z',
    hairShinePaths: ['M 58 80 C 60 62 72 52 88 48 C 74 56 64 66 62 82 Z'],
    earring: 'drop',
  },
];

export const FACE_PRESET_MAP: Record<string, FacePreset> = Object.fromEntries(
  FACE_PRESETS.map((p) => [p.id, p]),
);
