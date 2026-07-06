import { useEffect, useRef } from 'react';
import { ORB_HUE, type OrbState } from './orbState';

/**
 * MentorFace — OWNED BY THE LEAD AGENT (hero visual, Phase-1 feedback:
 * "a face for the mentor").
 *
 * A minimal face that lives INSIDE the Orb rather than replacing it: two
 * capsule eyes and a mouth, tinted by the Orb's state hue. Everything is
 * driven imperatively from one rAF loop (exponential smoothing toward
 * per-state targets — no React state per frame, no linear easing):
 *   idle      — soft eyes, slow gaze wander, natural blinks, faint smile
 *   listening — eyes widen and lock center, blinks stretch out
 *   thinking  — eyes narrow, gaze saccades up and aside
 *   speaking  — mouth opens with the live TTS envelope, eyes relax
 * `frozen` (reduced motion) renders a static friendly face and never starts
 * the loop.
 */

export interface MentorFaceProps {
  state: OrbState;
  /** 0..1 audio level — mic while listening, TTS envelope while speaking. */
  levelRef: React.MutableRefObject<number>;
  /** Rendered box (px); the face is designed on a 200×200 viewBox. */
  size: number;
  frozen?: boolean;
}

/** Per-state feature targets (200×200 design space, face centered). */
const FACE_TARGETS: Record<
  OrbState,
  { eyeH: number; eyeY: number; smile: number; mouthW: number }
> = {
  idle: { eyeH: 19, eyeY: 90, smile: 4.5, mouthW: 22 },
  listening: { eyeH: 25, eyeY: 88, smile: 2.5, mouthW: 18 },
  thinking: { eyeH: 13, eyeY: 89, smile: 0.5, mouthW: 13 },
  speaking: { eyeH: 18, eyeY: 90, smile: 3.5, mouthW: 27 },
};

const EYE_W = 11;
const EYE_LX = 79;
const EYE_RX = 121;
const MOUTH_Y = 131;

/** Exponential approach — frame-rate independent smoothing. */
function approach(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function MentorFace({ state, levelRef, size, frozen }: MentorFaceProps) {
  const leftEyeRef = useRef<SVGRectElement>(null);
  const rightEyeRef = useRef<SVGRectElement>(null);
  const mouthLineRef = useRef<SVGPathElement>(null);
  const mouthOpenRef = useRef<SVGRectElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const stateRef = useRef(state);

  // A blink on every state change makes the transition feel deliberate.
  const blinkAtRef = useRef(0);
  useEffect(() => {
    if (stateRef.current !== state) blinkAtRef.current = performance.now();
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (frozen) return;

    // Mutable animation registers, design-space units.
    let eyeH = FACE_TARGETS.idle.eyeH;
    let eyeY = FACE_TARGETS.idle.eyeY;
    let smile = FACE_TARGETS.idle.smile;
    let mouthW = FACE_TARGETS.idle.mouthW;
    let open = 0; // speaking mouth height
    let gazeX = 0;
    let gazeY = 0;
    let gazeTX = 0;
    let gazeTY = 0;
    let hue = ORB_HUE[stateRef.current];
    let nextBlink = performance.now() + rand(1200, 3200);
    let nextSaccade = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const s = stateRef.current;
      const t = FACE_TARGETS[s];

      // ---- gaze -------------------------------------------------------
      if (s === 'thinking') {
        if (now >= nextSaccade) {
          // Recalling something: quick glances up and to a side.
          gazeTX = rand(2.5, 5) * (Math.random() < 0.5 ? -1 : 1);
          gazeTY = rand(-5.5, -3);
          nextSaccade = now + rand(900, 2100);
        }
      } else if (s === 'idle') {
        // Slow lissajous wander — alive, not staring.
        gazeTX = Math.sin(now / 2600) * 2.6;
        gazeTY = Math.cos(now / 3400) * 1.6;
      } else {
        gazeTX = 0;
        gazeTY = s === 'listening' ? -1 : 0;
      }
      const gazeTau = s === 'thinking' ? 0.07 : 0.45;
      gazeX = approach(gazeX, gazeTX, dt, gazeTau);
      gazeY = approach(gazeY, gazeTY, dt, gazeTau);

      // ---- blink ------------------------------------------------------
      if (blinkAtRef.current > 0) {
        nextBlink = Math.min(nextBlink, blinkAtRef.current);
        blinkAtRef.current = 0;
      }
      let blinkScale = 1;
      const sinceBlink = now - nextBlink;
      if (sinceBlink >= 0) {
        const BLINK_MS = 190;
        if (sinceBlink < BLINK_MS) {
          blinkScale = Math.max(0.08, 1 - Math.sin((Math.PI * sinceBlink) / BLINK_MS));
        } else {
          const longGaps = s === 'listening';
          nextBlink =
            now +
            (Math.random() < 0.18
              ? 260 // occasional double-blink
              : longGaps
                ? rand(4200, 7800)
                : rand(2800, 6200));
        }
      }

      // ---- features ---------------------------------------------------
      eyeH = approach(eyeH, t.eyeH, dt, 0.14);
      eyeY = approach(eyeY, t.eyeY, dt, 0.14);
      smile = approach(smile, t.smile, dt, 0.2);
      mouthW = approach(mouthW, t.mouthW, dt, 0.18);
      hue = approach(hue, ORB_HUE[s], dt, 0.5);

      // Speaking mouth: fast attack, slower decay on the TTS envelope.
      // sqrt = perceptual boost — typical speech RMS (~0.1-0.3) must still
      // read as a clearly open mouth, not a flat bar.
      const raw = s === 'speaking' ? levelRef.current : 0;
      const level = raw <= 0 ? 0 : Math.min(1, Math.sqrt(raw) * 1.35);
      const openTarget = level * 19;
      open = approach(open, openTarget, dt, openTarget > open ? 0.035 : 0.09);

      // ---- write to the DOM ------------------------------------------
      const h = Math.max(1.6, eyeH * blinkScale);
      for (const [el, x] of [
        [leftEyeRef.current, EYE_LX],
        [rightEyeRef.current, EYE_RX],
      ] as const) {
        if (!el) continue;
        el.setAttribute('x', String(x - EYE_W / 2 + gazeX));
        el.setAttribute('y', String(eyeY - h / 2 + gazeY));
        el.setAttribute('height', String(h));
        el.setAttribute('rx', String(Math.min(EYE_W, h) / 2));
      }

      const speakingMouth = open > 2.2;
      const line = mouthLineRef.current;
      if (line) {
        const half = mouthW / 2;
        line.setAttribute(
          'd',
          `M ${100 - half} ${MOUTH_Y} Q 100 ${MOUTH_Y + smile * 2} ${100 + half} ${MOUTH_Y}`,
        );
        line.style.opacity = speakingMouth ? '0' : '1';
      }
      const mouth = mouthOpenRef.current;
      if (mouth) {
        const mh = Math.max(2.5, open);
        const mw = mouthW + open * 0.35;
        mouth.setAttribute('x', String(100 - mw / 2));
        mouth.setAttribute('y', String(MOUTH_Y - mh / 2 + 1));
        mouth.setAttribute('width', String(mw));
        mouth.setAttribute('height', String(mh));
        mouth.setAttribute('rx', String(Math.min(mw, mh) / 2));
        mouth.style.opacity = speakingMouth ? '1' : '0';
      }

      const g = groupRef.current;
      if (g) {
        const tint = `hsl(${Math.round(hue)} 45% 97%)`;
        g.setAttribute('fill', tint);
        g.setAttribute('stroke', tint);
        g.style.filter = `drop-shadow(0 0 ${size / 42}px hsl(${Math.round(hue)} 85% 70% / 0.55))`;
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [frozen, levelRef, size]);

  const staticT = FACE_TARGETS.idle;
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0"
    >
      {/* soft shade behind the features so they read over the bright orb core */}
      <radialGradient id="mentor-face-shade">
        <stop offset="0%" stopColor="black" stopOpacity="0.22" />
        <stop offset="100%" stopColor="black" stopOpacity="0" />
      </radialGradient>
      <ellipse cx="100" cy="106" rx="52" ry="46" fill="url(#mentor-face-shade)" />
      <g ref={groupRef} strokeWidth="0" fill={`hsl(${ORB_HUE.idle} 45% 97%)`}>
        <rect
          ref={leftEyeRef}
          x={EYE_LX - EYE_W / 2}
          y={staticT.eyeY - staticT.eyeH / 2}
          width={EYE_W}
          height={staticT.eyeH}
          rx={EYE_W / 2}
        />
        <rect
          ref={rightEyeRef}
          x={EYE_RX - EYE_W / 2}
          y={staticT.eyeY - staticT.eyeH / 2}
          width={EYE_W}
          height={staticT.eyeH}
          rx={EYE_W / 2}
        />
        <path
          ref={mouthLineRef}
          d={`M ${100 - staticT.mouthW / 2} ${MOUTH_Y} Q 100 ${MOUTH_Y + staticT.smile * 2} ${100 + staticT.mouthW / 2} ${MOUTH_Y}`}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect ref={mouthOpenRef} x="88" y={MOUTH_Y} width="24" height="2.5" rx="1.25" opacity="0" />
      </g>
    </svg>
  );
}
