import { useEffect, useRef } from 'react';
import { ORB_HUE, ORB_ENERGY, type OrbState } from './orbState';

export interface FallbackOrbProps {
  state: OrbState;
  /** 0..1 live level (mic amplitude when listening, TTS envelope when speaking). */
  level?: number;
  size?: number;
  /** Freeze completely (prefers-reduced-motion): calm static gradient. */
  frozen?: boolean;
}

/**
 * CSS/Canvas-free fallback Orb (§4.3): radial gradient + animated blur pulse.
 * Used under prefers-reduced-motion or when WebGL is unavailable. Animates
 * only transform/opacity/filter — no layout work.
 */
export function FallbackOrb({ state, level = 0, size = 280, frozen = false }: FallbackOrbProps) {
  const coreRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (frozen) return;
    let t = 0;
    const tick = () => {
      t += 1 / 60;
      const energy = ORB_ENERGY[state];
      // breathing base + live level on top
      const breath = 1 + Math.sin(t * (state === 'thinking' ? 3.2 : 1.4)) * 0.02 * (1 + energy);
      const live = 1 + level * 0.08;
      if (coreRef.current) coreRef.current.style.transform = `scale(${breath * live})`;
      if (glowRef.current) glowRef.current.style.opacity = String(0.35 + energy * 0.3 + level * 0.25);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [state, level, frozen]);

  const hue = ORB_HUE[state];

  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Orb: ${state}`}>
      <div
        ref={glowRef}
        className="absolute inset-[-20%] rounded-full transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle, hsl(${hue} 85% 65% / 0.45) 0%, transparent 65%)`,
          filter: 'blur(24px)',
          opacity: 0.4,
        }}
      />
      <div
        ref={coreRef}
        className="absolute inset-0 rounded-full transition-[background] duration-700"
        style={{
          background: `radial-gradient(circle at 38% 32%, hsl(${(hue + 24) % 360} 90% 74%) 0%, hsl(${hue} 80% 58%) 45%, hsl(${(hue - 28 + 360) % 360} 70% 34%) 100%)`,
          boxShadow: `0 0 60px 0 hsl(${hue} 85% 65% / 0.35), inset 0 0 40px hsl(${(hue + 40) % 360} 90% 80% / 0.25)`,
        }}
      />
    </div>
  );
}
