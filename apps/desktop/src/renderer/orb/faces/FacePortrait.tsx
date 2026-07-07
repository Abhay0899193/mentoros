import { useEffect, useId, useMemo, useRef } from 'react';
import type { FaceGlam, FaceMaturity } from '../../lib/coreClient';
import { ORB_HUE, ORB_ENERGY, type OrbState } from '../orbState';
import {
  hexMix,
  resolveStyle,
  type FaceGeometry,
  type FacePreset,
  type ResolvedStyle,
} from './presets';

/**
 * FacePortrait — OWNED BY THE LEAD AGENT (hero visual, face-gallery slice).
 *
 * A stylized-realistic portrait rendered from pure preset data inside a
 * circular cameo — "the Orb becomes her": the state-hued aurora survives as
 * a halo + rim light, so the one-living-element rule (§3.0.3) still holds.
 * All motion is imperative from a single rAF loop (exponential smoothing,
 * no React state per frame): blinks, gaze wander/saccades, brow language,
 * head sway, breathing, and a TTS-envelope-driven articulated mouth.
 * `frozen` renders a calm static portrait and never starts the loop.
 */

export interface FacePortraitProps {
  preset: FacePreset;
  glam: FaceGlam;
  maturity: FaceMaturity;
  state: OrbState;
  /** 0..1 audio level (TTS envelope while speaking). Optional for previews. */
  levelRef?: React.MutableRefObject<number>;
  size: number;
  frozen?: boolean;
}

/* --------------------------- geometry builders --------------------------- */

function facePath(g: FaceGeometry, chinDrop = 0): string {
  const top = 38;
  const chin = g.chinY + chinDrop;
  const R = (x: number) => 100 + x;
  const L = (x: number) => 100 - x;
  return [
    `M 100 ${top}`,
    `C ${R(g.templeW * 0.62)} ${top} ${R(g.templeW)} ${top + 13} ${R(g.templeW)} ${top + 29}`,
    `C ${R(g.templeW)} ${top + 44} ${R(g.cheekW)} 85 ${R(g.cheekW)} 100`,
    `C ${R(g.cheekW)} 114 ${R(g.jawW + 4.5)} 123 ${R(g.jawW)} 131`,
    `C ${R(g.jawW - 4)} ${chin - 9} ${R(10.5)} ${chin} 100 ${chin}`,
    `C ${L(10.5)} ${chin} ${L(g.jawW - 4)} ${chin - 9} ${L(g.jawW)} 131`,
    `C ${L(g.jawW + 4.5)} 123 ${L(g.cheekW)} 114 ${L(g.cheekW)} 100`,
    `C ${L(g.cheekW)} 85 ${L(g.templeW)} ${top + 44} ${L(g.templeW)} ${top + 29}`,
    `C ${L(g.templeW)} ${top + 13} ${L(g.templeW * 0.62)} ${top} 100 ${top}`,
    'Z',
  ].join(' ');
}

/** Almond eye in local coords; +x points to the OUTER corner. */
function eyePath(w: number, h: number): string {
  return [
    `M ${-w} 0.5`,
    `C ${-w * 0.5} ${-h} ${w * 0.5} ${-h * 1.02} ${w} -0.6`,
    `C ${w * 0.55} ${h * 0.86} ${-w * 0.5} ${h * 0.95} ${-w} 0.5`,
    'Z',
  ].join(' ');
}

/** Upper-lash line along the eye's upper lid (local coords). */
function lashLinePath(w: number, h: number): string {
  return `M ${-w + 1.6} ${-h * 0.32} C ${-w * 0.45} ${-h - 0.4} ${w * 0.5} ${-h * 1.02 - 0.4} ${w} -0.8`;
}

/** Neck shape in world coords (also the clip for the under-jaw shadow). */
const NECK_PATH = 'M 87 138 L 85 176 Q 100 182 115 176 L 113 138 Z';

/** Right brow in world coords; the left is mirrored around x=100. */
function browPath(g: FaceGeometry): string {
  const y = g.browY;
  const x0 = 108.5;
  const x1 = 100 + g.eyeDX + 1;
  const x2 = 100 + g.eyeDX + 13;
  const arch = g.browArch * 5;
  const th = g.browThick + 0.3;
  return [
    `M ${x0} ${y + 2.4}`,
    `C ${x0 + 4} ${y - arch * 0.7} ${x1 - 5} ${y - arch} ${x1} ${y - arch}`,
    `C ${x1 + 5} ${y - arch} ${x2 - 3.5} ${y - arch * 0.35} ${x2} ${y + 1.2}`,
    `C ${x2 - 3.5} ${y + 1.6} ${x1 + 4} ${y - arch + th} ${x1} ${y - arch + th}`,
    `C ${x1 - 4.5} ${y - arch + th} ${x0 + 3.5} ${y + 1.4} ${x0} ${y + 2.4}`,
    'Z',
  ].join(' ');
}

interface MouthShapes {
  upper: string;
  inner: string;
  lower: string;
  teethY: number;
  teethH: number;
  glossY: number;
}

function mouthShapes(g: FaceGeometry, smile: number, open: number): MouthShapes {
  const y = g.lipY;
  const w = g.lipW + open * 0.18;
  const lx = 100 - w;
  const rx = 100 + w;
  const cornerY = y - smile * 1.15 + open * 0.32;
  const bowY = y - g.lipUpper * 0.9 - smile * 0.25;
  const seamY = y + 0.5 + open * 0.12;
  const lowTop = y + 0.8 + open;
  const lowBot = y + g.lipLower * 1.45 + open * 1.05;
  const upper = [
    `M ${lx} ${cornerY}`,
    `C ${lx + w * 0.3} ${bowY - 0.2} ${100 - 6.5} ${bowY} ${100 - 3.6} ${bowY}`,
    `Q 100 ${bowY + 1.7} ${100 + 3.6} ${bowY}`,
    `C ${100 + 6.5} ${bowY} ${rx - w * 0.3} ${bowY - 0.2} ${rx} ${cornerY}`,
    `Q 100 ${seamY + 0.5} ${lx} ${cornerY}`,
    'Z',
  ].join(' ');
  const inner = [
    `M ${lx + 0.6} ${cornerY}`,
    `Q 100 ${seamY} ${rx - 0.6} ${cornerY}`,
    `Q 100 ${lowTop + 0.4} ${lx + 0.6} ${cornerY}`,
    'Z',
  ].join(' ');
  const lower = [
    `M ${lx} ${cornerY}`,
    `Q 100 ${lowTop} ${rx} ${cornerY}`,
    `C ${rx - 2} ${lowBot - 1} ${100 + 8} ${lowBot} 100 ${lowBot}`,
    `C ${100 - 8} ${lowBot} ${lx + 2} ${lowBot - 1} ${lx} ${cornerY}`,
    'Z',
  ].join(' ');
  return {
    upper,
    inner,
    lower,
    teethY: seamY + 0.6,
    teethH: Math.min(open * 0.55, 5.5),
    glossY: (lowTop + lowBot) / 2,
  };
}

/* ----------------------- per-state expression targets -------------------- */

const EXPRESSIONS: Record<
  OrbState,
  { aperture: number; browLift: number; furrow: number; smile: number; tilt: number; dy: number }
> = {
  idle: { aperture: 1, browLift: 0, furrow: 0, smile: 1.9, tilt: 0, dy: 0 },
  listening: { aperture: 1.13, browLift: -2.4, furrow: 0, smile: 1.1, tilt: -0.8, dy: -1.2 },
  thinking: { aperture: 0.72, browLift: 1, furrow: 1, smile: 0.2, tilt: 2.3, dy: 0.5 },
  speaking: { aperture: 0.96, browLift: -0.7, furrow: 0, smile: 1.6, tilt: 0, dy: 0 },
};

function approach(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const GOLD = '#E3BE6E';
const FALLBACK_LEVEL = { current: 0 } as React.MutableRefObject<number>;

/* -------------------------------- component ------------------------------ */

export function FacePortrait({
  preset,
  glam,
  maturity,
  state,
  levelRef = FALLBACK_LEVEL,
  size,
  frozen,
}: FacePortraitProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `fp-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  const style: ResolvedStyle = useMemo(
    () => resolveStyle(preset, glam, maturity),
    [preset, glam, maturity],
  );
  const g = style.geo;
  const p = preset.palette;

  /* refs for the animated nodes */
  const breathRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGPathElement>(null);
  const blinkLRef = useRef<SVGGElement>(null);
  const blinkRRef = useRef<SVGGElement>(null);
  const irisLRef = useRef<SVGGElement>(null);
  const irisRRef = useRef<SVGGElement>(null);
  const browLRef = useRef<SVGGElement>(null);
  const browRRef = useRef<SVGGElement>(null);
  const upperLipRef = useRef<SVGPathElement>(null);
  const innerRef = useRef<SVGPathElement>(null);
  const innerClipRef = useRef<SVGPathElement>(null);
  const lowerLipRef = useRef<SVGPathElement>(null);
  const teethRef = useRef<SVGRectElement>(null);
  const glossRef = useRef<SVGEllipseElement>(null);
  const auraStopRef = useRef<SVGStopElement>(null);
  const rimHairRef = useRef<SVGPathElement>(null);
  const rimFaceRef = useRef<SVGPathElement>(null);
  const stateRef = useRef(state);

  const blinkAtRef = useRef(0);
  useEffect(() => {
    if (stateRef.current !== state) blinkAtRef.current = performance.now();
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (frozen) return;

    let aperture = 1;
    let browLift = 0;
    let furrow = 0;
    let smile = EXPRESSIONS.idle.smile;
    let tilt = 0;
    let dy = 0;
    let open = 0;
    let nod = 0;
    let gazeX = 0;
    let gazeY = 0;
    let gazeTX = 0;
    let gazeTY = 0;
    let hue = ORB_HUE[stateRef.current];
    let energy = ORB_ENERGY[stateRef.current];
    let nextBlink = performance.now() + rand(1400, 3400);
    let nextSaccade = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const s = stateRef.current;
      const t = EXPRESSIONS[s];

      /* gaze */
      if (s === 'thinking') {
        if (now >= nextSaccade) {
          gazeTX = rand(1.6, 2.8) * (Math.random() < 0.5 ? -1 : 1);
          gazeTY = rand(-2.6, -1.6);
          nextSaccade = now + rand(900, 2100);
        }
      } else if (s === 'idle') {
        gazeTX = Math.sin(now / 2600) * 1.4;
        gazeTY = Math.cos(now / 3400) * 0.8;
      } else {
        gazeTX = 0;
        gazeTY = s === 'listening' ? -0.5 : 0;
      }
      const gazeTau = s === 'thinking' ? 0.07 : 0.45;
      gazeX = approach(gazeX, gazeTX, dt, gazeTau);
      gazeY = approach(gazeY, gazeTY, dt, gazeTau);

      /* blink */
      if (blinkAtRef.current > 0) {
        nextBlink = Math.min(nextBlink, blinkAtRef.current);
        blinkAtRef.current = 0;
      }
      let blinkScale = 1;
      const sinceBlink = now - nextBlink;
      if (sinceBlink >= 0) {
        const BLINK_MS = 180;
        if (sinceBlink < BLINK_MS) {
          blinkScale = Math.max(0.06, 1 - Math.sin((Math.PI * sinceBlink) / BLINK_MS));
        } else {
          nextBlink =
            now +
            (Math.random() < 0.16
              ? 240
              : s === 'listening'
                ? rand(4200, 7800)
                : rand(2600, 6000));
        }
      }

      /* expression */
      aperture = approach(aperture, t.aperture, dt, 0.16);
      browLift = approach(browLift, t.browLift, dt, 0.18);
      furrow = approach(furrow, t.furrow, dt, 0.22);
      smile = approach(smile, t.smile, dt, 0.25);
      tilt = approach(tilt, t.tilt, dt, 0.5);
      dy = approach(dy, t.dy, dt, 0.4);
      hue = approach(hue, ORB_HUE[s], dt, 0.5);
      energy = approach(energy, ORB_ENERGY[s], dt, 0.5);

      /* mouth — fast attack, slower decay on the TTS envelope (sqrt =
         perceptual boost so real speech RMS reads as articulate lips) */
      const raw = s === 'speaking' ? levelRef.current : 0;
      const level = raw <= 0 ? 0 : Math.min(1, Math.sqrt(raw) * 1.3);
      const openTarget = level * 8.5;
      open = approach(open, openTarget, dt, openTarget > open ? 0.035 : 0.09);
      nod = approach(nod, level, dt, 0.12);

      /* writes */
      const breath = 1 + Math.sin(now / 1900) * 0.006;
      breathRef.current?.setAttribute(
        'transform',
        `translate(100 130) scale(${breath}) translate(-100 -130)`,
      );
      headRef.current?.setAttribute(
        'transform',
        `translate(${Math.sin(now / 3800) * 0.8} ${dy + Math.cos(now / 3100) * 0.5 - nod * 1.1}) rotate(${tilt + Math.sin(now / 4600) * 0.5} 100 128)`,
      );
      faceRef.current?.setAttribute('d', facePath(g, open * 0.32));

      const blink = Math.min(blinkScale, 1) * aperture;
      const lidDrop = (1 - Math.min(blinkScale, 1)) * g.eyeH * 0.4;
      for (const el of [blinkLRef.current, blinkRRef.current]) {
        el?.setAttribute('transform', `translate(0 ${lidDrop}) scale(1 ${Math.max(0.05, blink)})`);
      }
      irisLRef.current?.setAttribute('transform', `translate(${-gazeX} ${gazeY})`);
      irisRRef.current?.setAttribute('transform', `translate(${gazeX} ${gazeY})`);

      const bx2 = 100 + g.eyeDX + 13;
      browRRef.current?.setAttribute(
        'transform',
        `translate(0 ${browLift}) rotate(${-6.5 * furrow} ${bx2} ${g.browY})`,
      );
      browLRef.current?.setAttribute(
        'transform',
        `translate(0 ${browLift}) rotate(${6.5 * furrow} ${200 - bx2} ${g.browY})`,
      );

      const m = mouthShapes(g, smile, open);
      upperLipRef.current?.setAttribute('d', m.upper);
      innerRef.current?.setAttribute('d', m.inner);
      innerClipRef.current?.setAttribute('d', m.inner);
      lowerLipRef.current?.setAttribute('d', m.lower);
      if (teethRef.current) {
        teethRef.current.setAttribute('y', String(m.teethY));
        teethRef.current.setAttribute('height', String(Math.max(0, m.teethH)));
        teethRef.current.style.opacity = m.teethH > 1 ? '1' : '0';
      }
      glossRef.current?.setAttribute('cy', String(m.glossY));

      const hu = Math.round(hue);
      auraStopRef.current?.setAttribute(
        'stop-color',
        `hsl(${hu} 80% 62% / ${0.28 + energy * 0.2})`,
      );
      const rim = `hsl(${hu} 85% 72%)`;
      if (rimHairRef.current) {
        rimHairRef.current.setAttribute('stroke', rim);
        rimHairRef.current.style.opacity = String(0.4 + energy * 0.45);
      }
      if (rimFaceRef.current) {
        rimFaceRef.current.setAttribute('stroke', rim);
        rimFaceRef.current.style.opacity = String(0.25 + energy * 0.3);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [frozen, levelRef, g]);

  /* static render (also the frozen portrait) */
  const face = facePath(g);
  const eye = eyePath(g.eyeW, g.eyeH);
  const lash = lashLinePath(g.eyeW, g.eyeH);
  const brow = browPath(g);
  const m0 = mouthShapes(g, EXPRESSIONS.idle.smile, 0);
  const hue0 = ORB_HUE[state];
  const irisR = 4.35 * style.irisScale;
  const earX = g.cheekW + 1.5;
  const lipDeep = hexMix(style.lip, '#40151E', 0.45);

  const renderEye = (side: 1 | -1) => {
    const ex = 100 + side * g.eyeDX;
    // Local +x = outer corner on both sides (right natural, left mirrored).
    const outerTransform =
      side === 1
        ? `translate(${ex} ${g.eyeY}) rotate(${-g.eyeTilt})`
        : `translate(${ex} ${g.eyeY}) rotate(${g.eyeTilt}) scale(-1 1)`;
    return (
      <g transform={outerTransform}>
        {style.eyeshadow > 0 && (
          <ellipse cx={0} cy={-g.eyeH - 2.5} rx={g.eyeW + 2} ry={5} fill={url('shadowG')} opacity={style.eyeshadow} />
        )}
        <path
          d={`M ${-g.eyeW * 0.8} ${-g.eyeH - 2.2} Q 0 ${-g.eyeH - 4.6} ${g.eyeW * 0.85} ${-g.eyeH - 1.6}`}
          fill="none"
          stroke={p.skinShade}
          strokeWidth={1}
          opacity={style.lidCrease}
        />
        <g ref={side === 1 ? blinkRRef : blinkLRef}>
          <path d={eye} fill="#F7F1EA" />
          <clipPath id={id(`ec${side}`)}>
            <path d={eye} />
          </clipPath>
          <g clipPath={`url(#${id(`ec${side}`)})`}>
            <g ref={side === 1 ? irisRRef : irisLRef}>
              <circle cx={0.5} cy={0.2} r={irisR} fill={url('irisG')} />
              <circle cx={0.5} cy={0.2} r={irisR * 0.45} fill="#12080A" />
              <circle cx={-1} cy={-1.4} r={1.05} fill="#FFFFFF" opacity={0.92} />
              <circle cx={1.9} cy={1.3} r={0.5} fill="#FFFFFF" opacity={0.5} />
            </g>
            {/* soft upper-lid shadow inside the eye */}
            <path d={eye} fill="#000" opacity={0.14} transform="translate(0 -4.6)" />
          </g>
          <path
            d={lash}
            fill="none"
            stroke={hexMix(p.brow, '#120D0B', 0.6)}
            strokeWidth={Math.max(0.9, style.linerW)}
            strokeLinecap="round"
          />
          {style.wing > 0 && (
            <path
              d={`M ${g.eyeW - 0.6} -0.9 Q ${g.eyeW + 2.4} ${-2.2 - style.wing} ${g.eyeW + 3.4 + style.wing * 1.6} ${-3.4 - style.wing * 1.4}`}
              fill="none"
              stroke={hexMix(p.brow, '#120D0B', 0.6)}
              strokeWidth={style.linerW * 0.9}
              strokeLinecap="round"
              opacity={0.9}
            />
          )}
          {style.lashes && (
            <g stroke={hexMix(p.brow, '#120D0B', 0.6)} strokeWidth={0.8} strokeLinecap="round">
              <path d={`M ${g.eyeW * 0.45} ${-g.eyeH - 0.3} q 1.4 -1.6 2.6 -2.1`} fill="none" />
              <path d={`M ${g.eyeW * 0.72} ${-g.eyeH + 0.6} q 1.6 -1.2 3 -1.6`} fill="none" />
              <path d={`M ${g.eyeW * 0.16} ${-g.eyeH - 0.7} q 1 -1.5 2 -2`} fill="none" />
            </g>
          )}
          {style.lowerLiner && (
            <path
              d={`M ${g.eyeW * 0.2} ${g.eyeH * 0.82} Q ${g.eyeW * 0.66} ${g.eyeH * 0.85} ${g.eyeW - 0.4} 0.4`}
              fill="none"
              stroke={hexMix(p.brow, '#120D0B', 0.5)}
              strokeWidth={0.7}
              opacity={0.55}
            />
          )}
        </g>
      </g>
    );
  };

  const renderEarring = (side: 1 | -1) => {
    if (style.earrings === 'none') return null;
    const x = 100 + side * (earX + 1.8);
    if (style.earrings === 'stud')
      return (
        <g>
          <circle cx={x} cy={109.5} r={1.5} fill={GOLD} />
          <circle cx={x - 0.4} cy={109} r={0.5} fill="#FFF3D0" />
        </g>
      );
    if (style.earrings === 'hoop')
      return (
        <circle cx={x} cy={115.5} r={4.6} fill="none" stroke={GOLD} strokeWidth={1.15} />
      );
    return (
      <g>
        <circle cx={x} cy={109.5} r={1} fill={GOLD} />
        <path d={`M ${x} 110 L ${x} 115.5`} stroke={GOLD} strokeWidth={0.7} />
        <ellipse cx={x} cy={118.5} rx={1.9} ry={3.1} fill={GOLD} />
        <ellipse cx={x - 0.6} cy={117.6} rx={0.6} ry={1.1} fill="#FFF3D0" opacity={0.8} />
      </g>
    );
  };

  return (
    <svg
      role="img"
      aria-label={`Mentor — ${preset.name}, ${state}`}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ display: 'block' }}
    >
      <defs>
        <clipPath id={id('cameo')}>
          <circle cx="100" cy="100" r="97" />
        </clipPath>
        <radialGradient id={id('aura')} cx="50%" cy="38%" r="62%">
          <stop
            ref={auraStopRef}
            offset="0%"
            stopColor={`hsl(${hue0} 80% 62% / 0.34)`}
          />
          <stop offset="100%" stopColor="hsl(248 60% 30% / 0)" />
        </radialGradient>
        <radialGradient id={id('skinG')} cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor={p.skinLight} />
          <stop offset="55%" stopColor={p.skin} />
          <stop offset="100%" stopColor={p.skinShade} />
        </radialGradient>
        <linearGradient id={id('hairBackG')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.hair} />
          <stop offset="55%" stopColor={hexMix(p.hair, p.hairDeep, 0.5)} />
          <stop offset="100%" stopColor={p.hairDeep} />
        </linearGradient>
        <linearGradient id={id('hairFrontG')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={hexMix(p.hair, p.hairShine, 0.35)} />
          <stop offset="70%" stopColor={p.hair} />
          <stop offset="100%" stopColor={hexMix(p.hair, p.hairDeep, 0.6)} />
        </linearGradient>
        <radialGradient id={id('irisG')} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor={hexMix(p.iris, '#FFFFFF', 0.28)} />
          <stop offset="62%" stopColor={p.iris} />
          <stop offset="88%" stopColor={p.irisEdge} />
          <stop offset="100%" stopColor={p.irisEdge} />
        </radialGradient>
        <radialGradient id={id('blushG')}>
          <stop offset="0%" stopColor={p.blush} stopOpacity={0.34 * style.blushK} />
          <stop offset="100%" stopColor={p.blush} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('shadowG')}>
          <stop offset="0%" stopColor={p.shadowTint} stopOpacity="0.9" />
          <stop offset="100%" stopColor={p.shadowTint} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('lipG')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={hexMix(style.lip, '#FFFFFF', 0.12)} />
          <stop offset="100%" stopColor={hexMix(style.lip, '#5A1E28', 0.3)} />
        </linearGradient>
        <linearGradient id={id('rimG')} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <mask id={id('rimM')}>
          <rect x="0" y="0" width="200" height="200" fill={url('rimG')} />
        </mask>
        <linearGradient id={id('vignG')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#05060A" stopOpacity="0" />
          <stop offset="100%" stopColor="#05060A" stopOpacity="0.5" />
        </linearGradient>
        <clipPath id={id('faceC')}>
          <path d={face} />
        </clipPath>
        <clipPath id={id('neckC')}>
          <path d={NECK_PATH} />
        </clipPath>
        <clipPath id={id('mouthC')}>
          <path ref={innerClipRef} d={m0.inner} />
        </clipPath>
      </defs>

      <g clipPath={url('cameo')}>
        {/* scene */}
        <rect x="0" y="0" width="200" height="200" fill="#0B0C12" />
        <circle cx="100" cy="78" r="94" fill={url('aura')} />

        <g ref={breathRef}>
          <g ref={headRef}>
            {/* hair behind the head */}
            <path d={preset.hairBack} fill={url('hairBackG')} />
            <g mask={url('rimM')}>
              <path
                ref={rimHairRef}
                d={preset.hairBack}
                fill="none"
                stroke={`hsl(${hue0} 85% 72%)`}
                strokeWidth={2.6}
                opacity={0.5}
              />
            </g>

            {/* neck (jaw shadow clipped to the neck shape so it doesn't band the sides) */}
            <path d={NECK_PATH} fill={p.skin} />
            <g clipPath={url('neckC')}>
              <ellipse cx="100" cy="143" rx="14.5" ry="8" fill={p.skinShade} opacity="0.4" />
            </g>

            {/* ears */}
            <ellipse cx={100 - earX} cy={103} rx={4.4} ry={7.6} fill={p.skin} />
            <ellipse cx={100 + earX} cy={103} rx={4.4} ry={7.6} fill={p.skin} />
            <path
              d={`M ${100 - earX - 1} 99 q -2 3.5 -0.4 7`}
              fill="none" stroke={p.skinShade} strokeWidth="1" opacity="0.5"
            />
            <path
              d={`M ${100 + earX + 1} 99 q 2 3.5 0.4 7`}
              fill="none" stroke={p.skinShade} strokeWidth="1" opacity="0.5"
            />

            {/* face */}
            <path ref={faceRef} d={face} fill={url('skinG')} />
            <g mask={url('rimM')}>
              <path
                ref={rimFaceRef}
                d={face}
                fill="none"
                stroke={`hsl(${hue0} 85% 72%)`}
                strokeWidth={1.6}
                opacity={0.3}
              />
            </g>

            <g clipPath={url('faceC')}>
              {/* under-hair soft shadow across the forehead */}
              <path d={preset.hairFront} transform="translate(0 3)" fill="#000" opacity="0.12" />
              {/* cheek contour (maturity) */}
              {style.contour > 0 && (
                <g
                  fill="none"
                  stroke={p.skinShade}
                  strokeLinecap="round"
                  opacity={style.contour * 0.3}
                >
                  <path d={`M ${100 + g.cheekW - 2} 103 Q ${100 + g.cheekW - 9} 112 ${100 + 13} 119`} strokeWidth="4.5" />
                  <path d={`M ${100 - g.cheekW + 2} 103 Q ${100 - g.cheekW + 9} 112 ${100 - 13} 119`} strokeWidth="4.5" />
                </g>
              )}
              {style.nasolabial > 0 && (
                <g fill="none" stroke={p.skinShade} strokeLinecap="round" opacity={style.nasolabial * 0.4}>
                  <path d={`M ${100 + g.noseW + 2.5} 121 Q ${100 + g.lipW + 3} 128 ${100 + g.lipW - 1} 137`} strokeWidth="1.1" />
                  <path d={`M ${100 - g.noseW - 2.5} 121 Q ${100 - g.lipW - 3} 128 ${100 - g.lipW + 1} 137`} strokeWidth="1.1" />
                </g>
              )}
              {/* blush + cheekbone highlight */}
              <circle cx={100 - (g.cheekW - 11)} cy={113} r={10.5} fill={url('blushG')} />
              <circle cx={100 + (g.cheekW - 11)} cy={113} r={10.5} fill={url('blushG')} />
              {style.highlight > 0 && (
                <g fill="#FFF6EC" opacity={style.highlight}>
                  <ellipse cx={100 - (g.cheekW - 8)} cy={105.5} rx={7} ry={2.4} transform={`rotate(-14 ${100 - (g.cheekW - 8)} 105.5)`} />
                  <ellipse cx={100 + (g.cheekW - 8)} cy={105.5} rx={7} ry={2.4} transform={`rotate(14 ${100 + (g.cheekW - 8)} 105.5)`} />
                </g>
              )}
              {/* freckles / beauty mark */}
              {preset.freckles?.map(([fx, fy], i) => (
                <circle key={i} cx={fx} cy={fy} r={0.75} fill={p.skinShade} opacity={0.55} />
              ))}
              {preset.beautyMark && (
                <circle cx={preset.beautyMark[0]} cy={preset.beautyMark[1]} r={1} fill="#221510" opacity={0.8} />
              )}
            </g>

            {/* nose */}
            <g>
              <path
                d={`M 96.3 106 C 96 110 95.9 113.5 96.5 116`}
                fill="none" stroke={p.skinShade} strokeWidth="1.4" opacity="0.08"
              />
              <path
                d={`M 103.7 106 C 104 110 104.1 113.5 103.5 116`}
                fill="none" stroke={p.skinShade} strokeWidth="1.6" opacity="0.1"
              />
              <ellipse cx="100" cy="118" rx="2.3" ry="1.4" fill={p.skinLight} opacity="0.5" />
              <path
                d={`M ${100 - g.noseW} 119.5 Q ${100 - g.noseW - 1.7} 121.3 ${100 - g.noseW + 0.7} 122.9`}
                fill="none" stroke={p.skinShade} strokeWidth="1.1" opacity="0.55"
              />
              <path
                d={`M ${100 + g.noseW} 119.5 Q ${100 + g.noseW + 1.7} 121.3 ${100 + g.noseW - 0.7} 122.9`}
                fill="none" stroke={p.skinShade} strokeWidth="1.1" opacity="0.55"
              />
              <ellipse cx={100 - 3.5} cy={121.9} rx={1.25} ry={0.7} fill={hexMix(p.skinShade, '#000000', 0.35)} opacity="0.35" transform={`rotate(24 ${100 - 3.5} 121.9)`} />
              <ellipse cx={100 + 3.5} cy={121.9} rx={1.25} ry={0.7} fill={hexMix(p.skinShade, '#000000', 0.35)} opacity="0.35" transform={`rotate(-24 ${100 + 3.5} 121.9)`} />
              <ellipse cx="100" cy="124.7" rx="4.2" ry="1.1" fill={p.skinShade} opacity="0.14" />
            </g>

            {/* brows */}
            <g fill={p.brow} opacity={0.82 + style.browDefine * 0.18}>
              <g ref={browRRef}>
                <path d={brow} />
              </g>
              <g ref={browLRef}>
                <g transform="translate(200 0) scale(-1 1)">
                  <path d={brow} />
                </g>
              </g>
            </g>

            {/* eyes */}
            {renderEye(-1)}
            {renderEye(1)}

            {/* mouth */}
            <g>
              <path ref={innerRef} d={m0.inner} fill="#3A141C" />
              <g clipPath={url('mouthC')}>
                <rect
                  ref={teethRef}
                  x={100 - g.lipW * 0.62}
                  y={m0.teethY}
                  width={g.lipW * 1.24}
                  height={0}
                  rx={1.6}
                  fill="#F3EDE4"
                  style={{ opacity: 0 }}
                />
              </g>
              <path ref={lowerLipRef} d={m0.lower} fill={url('lipG')} />
              <path ref={upperLipRef} d={m0.upper} fill={lipDeep} />
              <ellipse
                ref={glossRef}
                cx={100 - g.lipW * 0.3}
                cy={m0.glossY}
                rx={g.lipW * 0.42}
                ry={1.3}
                fill="#FFFFFF"
                opacity={style.lipGloss}
              />
              {/* philtrum + chin shading */}
              <ellipse cx="100" cy={g.chinY - 7} rx="6.5" ry="2" fill={p.skinShade} opacity="0.1" />
            </g>

            {/* hair over the forehead */}
            <path d={preset.hairFront} fill={url('hairFrontG')} />
            {preset.hairShinePaths?.map((d, i) => (
              <path key={i} d={d} fill={p.hairShine} opacity="0.5" />
            ))}

            {renderEarring(-1)}
            {renderEarring(1)}
          </g>

          {/* shoulders / garment (static under the swaying head) */}
          <path
            d="M 18 202 C 26 176 52 167 78 164.5 C 85 164 91 169 100 169 C 109 169 115 164 122 164.5 C 148 167 174 176 182 202 Z"
            fill={p.garment}
          />
          <path
            d="M 78 164.5 C 85 164 91 169 100 169 C 109 169 115 164 122 164.5 C 118 170 110 174.5 100 174.5 C 90 174.5 82 170 78 164.5 Z"
            fill={p.skin}
            opacity="0.9"
          />
        </g>

        {/* grounding vignette */}
        <rect x="0" y="130" width="200" height="70" fill={url('vignG')} />
      </g>

      {/* cameo ring */}
      <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    </svg>
  );
}
