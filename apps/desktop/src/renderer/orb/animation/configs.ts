import type { AnimationClip, AvatarConfig } from '../../lib/coreClient';
import type { RealisticPreset } from '../faces/realistic';
import type { FacePreset } from '../faces/presets';

/**
 * AvatarConfig synthesis for BUNDLED presets. Custom presets get their config
 * from core (config_json, or core-side legacy synthesis); the built-ins have
 * no DB row — their art ships in the bundle — so the equivalent config is
 * assembled here, from the same recipe core uses for legacy rows. This is the
 * zero-migration guarantee: every preset, old or new, speaks AvatarConfig.
 */

const EPOCH = '2026-07-10T00:00:00.000Z';

/** The legacy five-frame sprite recipe (blink on 'eyes', envelope talk on 'mouth'). */
export function realisticBuiltinConfig(preset: RealisticPreset): AvatarConfig {
  const animations: AnimationClip[] = [
    {
      id: 'blink',
      name: 'Blink',
      category: 'idle',
      appliesTo: 'portrait',
      renderKind: 'sprite',
      track: 'eyes',
      frames: [preset.portrait.blink],
      driver: 'time',
      durationMs: 130,
      loopMode: 'once',
      priority: 10,
    },
    {
      id: 'talk',
      name: 'Talk',
      category: 'idle',
      appliesTo: 'portrait',
      renderKind: 'sprite',
      track: 'mouth',
      frames: [preset.portrait.mouthSmall, preset.portrait.mouthOpen, preset.portrait.mouthWide],
      driver: 'envelope',
      loopMode: 'loop',
      priority: 20,
    },
  ];
  return {
    schemaVersion: 1,
    presetId: preset.id,
    name: preset.name,
    accent: preset.accent,
    baseFrame: preset.portrait.base,
    fullBase: preset.full,
    animations,
    triggers: [
      { id: 'blink-auto', animationId: 'blink', kind: 'randomInterval', minMs: 2400, maxMs: 5200, enabled: true },
    ],
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

/**
 * Stylized (procedural SVG) participation: gesture clips expressed as
 * pose-channel keyframes. FacePortrait keeps its own living choreography
 * (smoothing, gaze, breath); an active clip STEERS those channels — it never
 * replaces the math. Blink/talk stay intrinsic to the portrait (they already
 * are its idle life); these clips are what triggers/manual playback drive.
 */
export function stylizedConfig(preset: FacePreset): AvatarConfig {
  const gesture = (id: string, name: string, durationMs: number, pose: AnimationClip['proceduralPose']): AnimationClip => ({
    id,
    name,
    category: 'gesture',
    appliesTo: 'portrait',
    renderKind: 'procedural',
    track: 'pose',
    proceduralPose: pose,
    driver: 'time',
    durationMs,
    loopMode: 'once',
    priority: 30,
  });
  return {
    schemaVersion: 1,
    presetId: preset.id,
    name: preset.name,
    accent: preset.palette.blush,
    baseFrame: '',
    animations: [
      gesture('nod', 'Nod', 950, [
        { at: 0, pose: { dy: 0 } },
        { at: 0.22, pose: { dy: 2.6, tilt: 0 } },
        { at: 0.5, pose: { dy: -1.2 } },
        { at: 0.74, pose: { dy: 2.1 } },
        { at: 1, pose: { dy: 0 } },
      ]),
      gesture('smile', 'Beam', 1900, [
        { at: 0, pose: { smile: 1.9 } },
        { at: 0.22, pose: { smile: 3.6, aperture: 1.05 } },
        { at: 0.75, pose: { smile: 3.4 } },
        { at: 1, pose: { smile: 1.9 } },
      ]),
      gesture('brow-raise', 'Brow raise', 750, [
        { at: 0, pose: { browLift: 0 } },
        { at: 0.3, pose: { browLift: -3.2, aperture: 1.18 } },
        { at: 0.7, pose: { browLift: -3.2 } },
        { at: 1, pose: { browLift: 0 } },
      ]),
      gesture('wink-blink', 'Slow blink', 420, [
        { at: 0, pose: { blink: 0 } },
        { at: 0.4, pose: { blink: 1, smile: 2.6 } },
        { at: 0.75, pose: { blink: 1 } },
        { at: 1, pose: { blink: 0 } },
      ]),
    ],
    triggers: [],
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}
