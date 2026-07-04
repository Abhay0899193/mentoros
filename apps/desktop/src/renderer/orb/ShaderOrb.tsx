import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { orbVertex, orbFragment } from './shaders';
import { ORB_HUE, ORB_ENERGY, type OrbState } from './orbState';

/** Per-state shader targets — uniforms lerp toward these each frame (no snaps). */
const STATE_PARAMS: Record<OrbState, { freq: number; speed: number; amp: number; glow: number }> = {
  idle: { freq: 1.2, speed: 0.22, amp: 0.1, glow: 0.35 },
  listening: { freq: 2.4, speed: 0.55, amp: 0.16, glow: 0.6 },
  thinking: { freq: 3.6, speed: 1.15, amp: 0.13, glow: 0.5 },
  speaking: { freq: 1.9, speed: 0.6, amp: 0.14, glow: 0.85 },
};

function hueColors(state: OrbState, driftDeg: number): { a: THREE.Color; b: THREE.Color } {
  const h = ((ORB_HUE[state] + driftDeg) % 360) / 360;
  return {
    a: new THREE.Color().setHSL(h, 0.72, 0.5),
    b: new THREE.Color().setHSL((h + 0.09) % 1, 0.85, 0.68),
  };
}

export interface ShaderOrbProps {
  state: OrbState;
  /** Mutable live level 0..1 — mic amplitude (listening) or TTS envelope (speaking). */
  levelRef: React.MutableRefObject<number>;
}

export function ShaderOrb({ state, levelRef }: ShaderOrbProps) {
  const mesh = useRef<THREE.Mesh>(null);

  const coreUniforms = useMemo(() => {
    const { a, b } = hueColors('idle', 0);
    return {
      uTime: { value: 0 },
      uAmp: { value: STATE_PARAMS.idle.amp },
      uFreq: { value: STATE_PARAMS.idle.freq },
      uSpeed: { value: STATE_PARAMS.idle.speed },
      uAudio: { value: 0 },
      uGlow: { value: STATE_PARAMS.idle.glow },
      uColorA: { value: a.clone() },
      uColorB: { value: b.clone() },
    };
  }, []);

  useFrame((_, delta) => {
    const p = STATE_PARAMS[state];
    const u = coreUniforms;
    // Aurora hue drift while idle (§4.3); pinned hue in active states.
    const drift = state === 'idle' ? Math.sin(u.uTime.value * 0.11) * 14 : 0;
    const { a, b } = hueColors(state, drift);
    const k = Math.min(1, delta * 3.2); // smooth-lerp factor (~300ms settle)

    u.uTime.value += delta;
    u.uAmp.value += (p.amp - u.uAmp.value) * k;
    u.uFreq.value += (p.freq - u.uFreq.value) * k;
    u.uSpeed.value += (p.speed - u.uSpeed.value) * k;
    u.uGlow.value += (p.glow - u.uGlow.value) * k;
    u.uColorA.value.lerp(a, k);
    u.uColorB.value.lerp(b, k);

    // live audio with fast attack, slower release — feels organic
    const target = Math.min(1, levelRef.current);
    const cur = u.uAudio.value;
    u.uAudio.value = target > cur ? cur + (target - cur) * Math.min(1, delta * 14) : cur + (target - cur) * Math.min(1, delta * 5);

    // idle breathing — gentle whole-orb scale, GPU-cheap
    if (mesh.current) {
      const breathHz = state === 'thinking' ? 0.55 : 0.22;
      const s = 1 + Math.sin(u.uTime.value * breathHz * Math.PI * 2) * 0.012 * (1 + ORB_ENERGY[state]);
      mesh.current.scale.setScalar(s);
    }
  });

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1, 96]} />
      <shaderMaterial
        vertexShader={orbVertex}
        fragmentShader={orbFragment}
        uniforms={coreUniforms}
        transparent
      />
    </mesh>
  );
}
