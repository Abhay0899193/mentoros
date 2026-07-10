import { useEffect, useMemo, useRef } from 'react';
import { ORB_HUE, type OrbState } from '../orbState';
import type { AvatarConfig, FaceView } from '../../lib/coreClient';
import { AnimationController } from './controller';

/**
 * SpritePortrait — generic sprite-stack player (replaces RealisticPortrait).
 *
 * Paints an AvatarConfig: the base frame always shows; every sprite clip's
 * frames are pre-mounted as pixel-aligned overlay layers (opacity 0) and the
 * AnimationController decides per tick which layers are visible — lip-sync,
 * blinks, and any custom gesture are all the same mechanism now. Breathing /
 * sway / speaking head-bob choreography is carried over verbatim so existing
 * presets read identically. `frozen` (reduced motion) renders the still base.
 */

export interface SpritePortraitProps {
  /** Absolutized config (frame paths ready for <img src>). */
  config: AvatarConfig;
  state: OrbState;
  /** Live TTS output level 0..1 (written by the voice loop each frame). */
  levelRef?: React.MutableRefObject<number>;
  /** Square footprint edge; 'full' view renders a 2:3 card inside it. */
  size: number;
  view?: FaceView;
  frozen?: boolean;
  /** Previews pass false so gallery cards don't react to global triggers. */
  reactive?: boolean;
  /** Exposes the controller (Studio preview drives it manually). */
  controllerRef?: React.MutableRefObject<AnimationController | null>;
}

const FALLBACK_LEVEL = { current: 0 };

interface Layer {
  key: string; // `${clipId}#${frameIndex}`
  src: string;
  /** Envelope layers crossfade a touch slower (legacy mouth feel). */
  transitionMs: number;
}

export function SpritePortrait({
  config,
  state,
  levelRef = FALLBACK_LEVEL,
  size,
  view = 'cameo',
  frozen = false,
  reactive = true,
  controllerRef,
}: SpritePortraitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef(new Map<string, HTMLImageElement>());
  const stateRef = useRef(state);
  stateRef.current = state;

  const cameo = view === 'cameo';
  const region = cameo ? 'portrait' : 'full';
  const hue = ORB_HUE[state];

  const controller = useMemo(
    () =>
      new AnimationController(config, {
        getOrbState: () => stateRef.current,
        levelRef,
        reactive,
      }),
    [config, levelRef, reactive],
  );

  useEffect(() => {
    if (controllerRef) controllerRef.current = controller;
    controller.attach();
    return () => controller.detach();
  }, [controller, controllerRef]);

  const base = cameo ? config.baseFrame : (config.fullBase ?? config.baseFrame);
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    for (const clip of config.animations) {
      if (clip.renderKind !== 'sprite' || clip.appliesTo !== region || !clip.frames) continue;
      clip.frames.forEach((src, i) => {
        out.push({ key: `${clip.id}#${i}`, src, transitionMs: clip.driver === 'envelope' ? 60 : 40 });
      });
    }
    return out;
  }, [config, region]);

  useEffect(() => {
    if (frozen) return;
    let raf = 0;
    const tick = (t: number) => {
      controller.tick(t);
      const visible = controller.visibleLayers(region);
      for (const [key, el] of layerRefs.current) {
        el.style.opacity = visible.has(key) ? '1' : '0';
      }
      // Breathing + sway; a whisper of head-bob while speaking.
      if (rootRef.current) {
        const level = controller.envelopeLevel();
        const breathe = 1 + 0.006 * Math.sin(t / 480);
        const sway = 0.45 * Math.sin(t / 830);
        const bob = -1.4 * level;
        rootRef.current.style.transform = `scale(${breathe}) rotate(${sway}deg) translateY(${bob}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozen, controller, region]);

  const frame = useMemo(
    () =>
      cameo
        ? { width: size, height: size, borderRadius: '9999px' }
        : { width: Math.round((size * 2) / 3), height: size, borderRadius: '16px' },
    [cameo, size],
  );

  const layerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    willChange: 'opacity',
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div ref={rootRef} className="relative overflow-hidden" style={frame}>
        <img src={base} alt="" draggable={false} style={layerStyle} />
        {!frozen &&
          layers.map((l) => (
            <img
              key={l.key}
              ref={(el) => {
                if (el) layerRefs.current.set(l.key, el);
                else layerRefs.current.delete(l.key);
              }}
              src={l.src}
              alt=""
              draggable={false}
              style={{ ...layerStyle, opacity: 0, transition: `opacity ${l.transitionMs}ms linear` }}
            />
          ))}
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
