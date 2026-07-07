import { useEffect, useMemo, useRef } from 'react';
import { ORB_HUE, type OrbState } from '../orbState';
import type { FaceView } from '../../lib/coreClient';
import type { RealisticPreset } from './realistic';

/**
 * RealisticPortrait — plays back a realistic preset's sprite stack.
 *
 * All frames are pixel-aligned full images (only the mouth/eye region differs,
 * courtesy of masked inpainting), so lip-sync is pure opacity switching over
 * the resting base frame — no layout, no repaints beyond compositing. A single
 * rAF loop drives the TTS-envelope mouth aperture (sqrt perceptual curve, fast
 * attack / slow release), autonomous blinks, and a breathing/sway transform,
 * mirroring the FacePortrait choreography so both face families feel alive in
 * the same way. `frozen` (reduced motion) renders the still base frame only.
 */

export interface RealisticPortraitProps {
  preset: RealisticPreset;
  state: OrbState;
  /** Live TTS output level 0..1 (written by the voice loop each frame). */
  levelRef?: React.MutableRefObject<number>;
  /** Square footprint edge; 'full' view renders a 2:3 card inside it. */
  size: number;
  view?: FaceView;
  frozen?: boolean;
}

const FALLBACK_LEVEL = { current: 0 };

/** Mouth aperture thresholds over the smoothed perceptual level. */
const APERTURE = { closed: 0.08, small: 0.36, open: 0.68 };

export function RealisticPortrait({
  preset,
  state,
  levelRef = FALLBACK_LEVEL,
  size,
  view = 'cameo',
  frozen = false,
}: RealisticPortraitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const m1Ref = useRef<HTMLImageElement>(null);
  const m2Ref = useRef<HTMLImageElement>(null);
  const m3Ref = useRef<HTMLImageElement>(null);
  const blinkRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const cameo = view === 'cameo';
  const hue = ORB_HUE[state];

  useEffect(() => {
    if (frozen) return;
    let raf = 0;
    let level = 0;
    let nextBlink = performance.now() + 1600 + Math.random() * 2600;
    let blinkUntil = 0;
    let last = performance.now();

    const tick = (t: number) => {
      const dt = Math.min((t - last) / 16.7, 3);
      last = t;

      // Envelope → perceptual aperture (sqrt opens the mouth at real speech RMS).
      const raw = stateRef.current === 'speaking' ? Math.sqrt(Math.max(0, levelRef.current)) : 0;
      const k = raw > level ? 0.55 : 0.16; // fast attack, slow release
      level += (raw - level) * Math.min(1, k * dt);

      const bucket =
        level < APERTURE.closed ? 0 : level < APERTURE.small ? 1 : level < APERTURE.open ? 2 : 3;
      if (cameo) {
        m1Ref.current && (m1Ref.current.style.opacity = bucket === 1 ? '1' : '0');
        m2Ref.current && (m2Ref.current.style.opacity = bucket === 2 ? '1' : '0');
        m3Ref.current && (m3Ref.current.style.opacity = bucket === 3 ? '1' : '0');
      }

      // Autonomous blinks.
      if (t >= nextBlink) {
        blinkUntil = t + 130;
        nextBlink = t + 2400 + Math.random() * 2800;
      }
      if (cameo && blinkRef.current) {
        blinkRef.current.style.opacity = t < blinkUntil ? '1' : '0';
      }

      // Breathing + sway; a whisper of head-bob while speaking.
      if (rootRef.current) {
        const breathe = 1 + 0.006 * Math.sin(t / 480);
        const sway = 0.45 * Math.sin(t / 830);
        const bob = -1.4 * level;
        rootRef.current.style.transform = `scale(${breathe}) rotate(${sway}deg) translateY(${bob}px)`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozen, cameo, levelRef]);

  const frame = useMemo(
    () =>
      cameo
        ? { width: size, height: size, borderRadius: '9999px' }
        : { width: Math.round((size * 2) / 3), height: size, borderRadius: '16px' },
    [cameo, size],
  );

  const layer: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'opacity 60ms linear',
    willChange: 'opacity',
  };

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div ref={rootRef} className="relative overflow-hidden" style={frame}>
        <img src={cameo ? preset.portrait.base : preset.full} alt="" draggable={false} style={{ ...layer, transition: 'none' }} />
        {cameo && (
          <>
            <img ref={m1Ref} src={preset.portrait.mouthSmall} alt="" draggable={false} style={{ ...layer, opacity: 0 }} />
            <img ref={m2Ref} src={preset.portrait.mouthOpen} alt="" draggable={false} style={{ ...layer, opacity: 0 }} />
            <img ref={m3Ref} src={preset.portrait.mouthWide} alt="" draggable={false} style={{ ...layer, opacity: 0 }} />
            <img ref={blinkRef} src={preset.portrait.blink} alt="" draggable={false} style={{ ...layer, transition: 'opacity 40ms linear', opacity: 0 }} />
          </>
        )}
        {/* state-hue rim + soft vignette, matching the stylized family's scene */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[box-shadow] duration-700"
          style={{
            borderRadius: frame.borderRadius,
            boxShadow: `inset 0 0 0 1px hsl(${hue} 80% 70% / 0.28), inset 0 -18px 32px -18px rgb(5 6 10 / 0.55)`,
          }}
        />
      </div>
    </div>
  );
}
