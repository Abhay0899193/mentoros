import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { useReducedMotion } from 'motion/react';
import { ShaderOrb } from './ShaderOrb';
import { FallbackOrb } from './FallbackOrb';
import { ORB_HUE, type OrbState } from './orbState';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface OrbCanvasProps {
  state: OrbState;
  levelRef: React.MutableRefObject<number>;
  size?: number;
  onTap?: () => void;
}

/**
 * The one living element (§3.0.3). Shader Orb on GPU; falls back to the CSS
 * orb under prefers-reduced-motion or missing WebGL (§4.3 fallback).
 */
export function OrbCanvas({ state, levelRef, size = 340, onTap }: OrbCanvasProps) {
  const reduce = useReducedMotion();
  const hasGL = useMemo(webglAvailable, []);
  const hue = ORB_HUE[state];

  if (reduce || !hasGL) {
    return (
      <button aria-label={`Orb — ${state}. Tap to interrupt.`} onClick={onTap} className="cursor-default">
        <FallbackOrb state={state} size={size} frozen={!!reduce} level={levelRef.current} />
      </button>
    );
  }

  return (
    <button
      aria-label={`Orb — ${state}. Tap to interrupt.`}
      onClick={onTap}
      className="relative cursor-default"
      style={{ width: size, height: size }}
    >
      {/* ambient glow behind the canvas — CSS, not post-processing */}
      <div
        aria-hidden
        className="absolute inset-[-25%] rounded-full transition-opacity duration-700"
        style={{
          background: `radial-gradient(circle, hsl(${hue} 85% 62% / 0.28) 0%, transparent 62%)`,
          filter: 'blur(28px)',
        }}
      />
      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <ShaderOrb state={state} levelRef={levelRef} />
        </Suspense>
      </Canvas>
    </button>
  );
}
