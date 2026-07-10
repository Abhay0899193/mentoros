import type {
  AnimationClip,
  AnimationRegion,
  AvatarConfig,
  PoseChannels,
  TriggerRule,
} from '../../lib/coreClient';
import type { OrbState } from '../orbState';
import { subscribeAvatarEvents, type AvatarEvent } from './avatarEvents';

/**
 * AnimationController — OWNED BY THE LEAD AGENT (generic avatar runtime).
 *
 * One headless clip scheduler per mounted avatar. Replaces the hardcoded
 * blink-timer + envelope-mouth loops of the old sprite player with generic
 * machinery that both families share:
 *
 *   · TRACKS — concurrency lanes. Clips on different tracks play at the same
 *     time (a blink lands mid-speech because 'eyes' and 'mouth' are separate
 *     lanes). Within a track, higher priority preempts; equal/lower queues.
 *   · DRIVERS — 'time' advances the playhead by fps/durationMs; 'envelope'
 *     maps the live TTS RMS to the playhead and is ALWAYS ARMED: it plays
 *     whenever the mentor is speaking and its track is free (that is exactly
 *     the old mouth behavior, so legacy presets need no trigger for it).
 *   · TRIGGERS — config rules wired to the renderer-wide avatar event bus
 *     plus per-controller timers (timer/randomInterval) and shortcuts.
 *
 * The paint step stays in the owning component: sprite portraits read
 * `visibleLayers()` (set of `clipId#frameIndex` keys), stylized portraits read
 * `poseTarget()` (merged procedural channel targets) — the strategy split on
 * `renderKind` from the plan.
 */

/** Legacy 3-aperture mouth thresholds (pixel parity with the old player). */
const LEGACY_3 = [0.08, 0.36, 0.68];
/** Below this smoothed level an envelope clip shows nothing (mouth closed). */
const ENVELOPE_CLOSED = 0.08;
const DEFAULT_FPS = 8;

interface ActiveClip {
  clip: AnimationClip;
  /** ms into the clip (time driver). */
  playhead: number;
  interrupted?: boolean;
}

interface Track {
  current: ActiveClip | null;
  queue: AnimationClip[];
  /** Envelope clip parked on this track — resumes whenever the track frees up. */
  armed: AnimationClip | null;
}

export interface ControllerOptions {
  getOrbState: () => OrbState;
  levelRef: { current: number };
  /** Restrict trigger playback (previews pass false to stay inert). */
  reactive?: boolean;
}

export class AnimationController {
  private readonly tracks = new Map<string, Track>();
  private readonly clips = new Map<string, AnimationClip>();
  private level = 0; // smoothed perceptual envelope
  private lastTick = 0;
  private detachFns: Array<() => void> = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private attached = false;

  constructor(
    readonly config: AvatarConfig,
    private readonly opts: ControllerOptions,
  ) {
    for (const clip of config.animations) {
      this.clips.set(clip.id, clip);
      const track = this.track(clip.track);
      // Envelope clips auto-arm (highest priority wins the slot).
      if (clip.driver === 'envelope' && (!track.armed || clip.priority > track.armed.priority)) {
        track.armed = clip;
      }
    }
    if (config.defaultAnimationId) this.request(config.defaultAnimationId);
  }

  /* ------------------------------- playback ------------------------------- */

  private track(name: string): Track {
    let t = this.tracks.get(name);
    if (!t) {
      t = { current: null, queue: [], armed: null };
      this.tracks.set(name, t);
    }
    return t;
  }

  /** Queue/play a clip. Returns false for unknown ids. */
  request(animationId: string, opts?: { interrupt?: boolean }): boolean {
    const clip = this.clips.get(animationId);
    if (!clip) return false;
    const track = this.track(clip.track);
    if (track.current?.clip.id === clip.id) return true; // already playing
    if (track.queue.some((c) => c.id === clip.id)) return true; // already queued
    if (!track.current || opts?.interrupt || clip.priority > track.current.clip.priority) {
      track.current = { clip, playhead: 0 };
    } else {
      track.queue.push(clip);
    }
    return true;
  }

  /** Stop a clip (holdLast/loop clips have no natural end). */
  release(animationId: string): void {
    for (const track of this.tracks.values()) {
      if (track.current?.clip.id === animationId) this.finish(track);
      track.queue = track.queue.filter((c) => c.id !== animationId);
    }
  }

  private finish(track: Track): void {
    track.current = null;
    const next = track.queue.shift();
    if (next) track.current = { clip: next, playhead: 0 };
  }

  /**
   * Advance every track. Call once per animation frame BEFORE reading
   * visibleLayers()/poseTarget(). dt derives from the caller's clock.
   */
  tick(now: number): void {
    const dt = this.lastTick === 0 ? 16.7 : Math.min(now - this.lastTick, 50);
    this.lastTick = now;

    // Smoothed perceptual envelope (sqrt boost, fast attack / slow release —
    // constants carried over verbatim from the old sprite player).
    const speaking = this.opts.getOrbState() === 'speaking';
    const raw = speaking ? Math.sqrt(Math.max(0, this.opts.levelRef.current)) : 0;
    const k = raw > this.level ? 0.55 : 0.16;
    this.level += (raw - this.level) * Math.min(1, k * (dt / 16.7));

    for (const track of this.tracks.values()) {
      // A free track resumes its armed envelope clip.
      if (!track.current && track.armed) track.current = { clip: track.armed, playhead: 0 };
      const active = track.current;
      if (!active || active.clip.driver !== 'time') continue;

      active.playhead += dt;
      const duration = clipDuration(active.clip);
      if (active.playhead < duration) continue;
      switch (active.clip.loopMode) {
        case 'loop':
        case 'pingpong':
          active.playhead %= duration;
          break;
        case 'holdLast':
          active.playhead = duration; // parked on the last frame until released
          break;
        case 'once':
          this.finish(track);
          break;
      }
    }
  }

  /** Smoothed 0..1 envelope (drives the speaking head-bob in the portrait). */
  envelopeLevel(): number {
    return this.level;
  }

  /**
   * Sprite layer keys (`clipId#frameIndex`) visible this tick for a region.
   * While a 'main'-track clip is mid-flight, overlay tracks of the region are
   * suppressed (pixel-aligned overlays only compose onto the base frame).
   */
  visibleLayers(region: AnimationRegion): Set<string> {
    const visible = new Set<string>();
    const mainActive = [...this.tracks.entries()].some(
      ([name, t]) =>
        name === 'main' && t.current && t.current.clip.appliesTo === region &&
        t.current.clip.renderKind === 'sprite',
    );
    for (const [name, track] of this.tracks) {
      const active = track.current;
      if (!active) continue;
      const { clip } = active;
      if (clip.renderKind !== 'sprite' || clip.appliesTo !== region || !clip.frames?.length) continue;
      if (mainActive && name !== 'main') continue;
      const index = this.frameIndex(active);
      if (index >= 0) visible.add(`${clip.id}#${Math.min(index, clip.frames.length - 1)}`);
    }
    return visible;
  }

  private frameIndex(active: ActiveClip): number {
    const { clip } = active;
    const n = clip.frames?.length ?? 0;
    if (n === 0) return -1;
    if (clip.driver === 'envelope') {
      if (this.level < ENVELOPE_CLOSED) return -1; // resting on base
      if (n === 3) {
        return this.level < LEGACY_3[1] ? 0 : this.level < LEGACY_3[2] ? 1 : 2;
      }
      return Math.min(n - 1, Math.floor(((this.level - ENVELOPE_CLOSED) / (1 - ENVELOPE_CLOSED)) * n));
    }
    const duration = clipDuration(clip);
    let t = Math.min(active.playhead / duration, 1);
    if (clip.loopMode === 'pingpong') t = t < 0.5 ? t * 2 : 2 - t * 2;
    return Math.min(n - 1, Math.floor(t * n));
  }

  /**
   * Merged procedural pose target (higher-priority clips win per channel).
   * Keyframes interpolate linearly on the normalized playhead.
   */
  poseTarget(): Partial<PoseChannels> | null {
    let merged: Partial<PoseChannels> | null = null;
    const actives = [...this.tracks.values()]
      .map((t) => t.current)
      .filter((a): a is ActiveClip => !!a && a.clip.renderKind === 'procedural')
      .sort((a, b) => a.clip.priority - b.clip.priority); // low→high; later wins
    for (const active of actives) {
      const frames = active.clip.proceduralPose;
      if (!frames?.length) continue;
      const duration = clipDuration(active.clip);
      let t = Math.min(active.playhead / duration, 1);
      if (active.clip.loopMode === 'pingpong') t = t < 0.5 ? t * 2 : 2 - t * 2;
      if (active.clip.driver === 'envelope') t = this.level;
      merged = { ...(merged ?? {}), ...samplePose(frames, t) };
    }
    return merged;
  }

  /* ------------------------------- triggers ------------------------------- */

  /** Subscribe to the event bus + start timer rules. Idempotent. */
  attach(): void {
    if (this.attached || this.opts.reactive === false) return;
    this.attached = true;
    let userMessages = 0;

    this.detachFns.push(
      subscribeAvatarEvents((evt) => this.onEvent(evt, evt.type === 'userMessage' ? ++userMessages : userMessages)),
    );

    for (const rule of this.config.triggers) {
      if (!rule.enabled) continue;
      if (rule.kind === 'timer') {
        const id = setInterval(() => this.request(rule.animationId), Math.max(250, rule.intervalMs));
        this.detachFns.push(() => clearInterval(id));
      } else if (rule.kind === 'randomInterval') {
        this.scheduleRandom(rule.animationId, rule.minMs, rule.maxMs);
      } else if (rule.kind === 'shortcut') {
        const handler = (e: KeyboardEvent) => {
          if (matchShortcut(e, rule.keys)) {
            e.preventDefault();
            this.request(rule.animationId, { interrupt: true });
          }
        };
        window.addEventListener('keydown', handler);
        this.detachFns.push(() => window.removeEventListener('keydown', handler));
      }
    }
  }

  private scheduleRandom(animationId: string, minMs: number, maxMs: number): void {
    const delay = minMs + Math.random() * Math.max(0, maxMs - minMs);
    const id = setTimeout(() => {
      this.request(animationId);
      this.scheduleRandom(animationId, minMs, maxMs);
    }, delay);
    this.timers.push(id);
  }

  private onEvent(evt: AvatarEvent, userMessageCount: number): void {
    for (const rule of this.config.triggers) {
      if (!rule.enabled) continue;
      if (ruleMatches(rule, evt, userMessageCount)) this.request(rule.animationId);
    }
  }

  detach(): void {
    this.attached = false;
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

/* --------------------------------- helpers -------------------------------- */

function clipDuration(clip: AnimationClip): number {
  if (clip.durationMs) return clip.durationMs;
  const n = clip.renderKind === 'sprite' ? (clip.frames?.length ?? 1) : (clip.proceduralPose?.length ?? 1);
  return (n / (clip.fps ?? DEFAULT_FPS)) * 1000;
}

/** Linear interpolation across pose keyframes at normalized time t. */
export function samplePose(
  frames: Array<{ at: number; pose: Partial<PoseChannels> }>,
  t: number,
): Partial<PoseChannels> {
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  if (t <= sorted[0].at) return sorted[0].pose;
  const last = sorted[sorted.length - 1];
  if (t >= last.at) return last.pose;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < a.at || t > b.at) continue;
    const span = b.at - a.at || 1;
    const k = (t - a.at) / span;
    const pose: Partial<PoseChannels> = { ...a.pose };
    for (const key of Object.keys(b.pose) as Array<keyof PoseChannels>) {
      const from = a.pose[key];
      const to = b.pose[key];
      pose[key] = from === undefined || to === undefined ? to : from + (to - from) * k;
    }
    return pose;
  }
  return last.pose;
}

/** 'alt+shift+w' style shortcut matcher ('mod' = ⌘ on mac / ctrl elsewhere). */
export function matchShortcut(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const wantMeta = mods.has('meta') || mods.has('cmd') || mods.has('mod');
  const wantCtrl = mods.has('ctrl') || (mods.has('mod') && !navigator.platform.toLowerCase().includes('mac'));
  if (e.key.toLowerCase() !== key) return false;
  if (mods.has('alt') !== e.altKey) return false;
  if (mods.has('shift') !== e.shiftKey) return false;
  if (wantMeta && !(e.metaKey || e.ctrlKey)) return false;
  if (!wantMeta && !wantCtrl && (e.metaKey || e.ctrlKey)) return false;
  return true;
}

function ruleMatches(rule: TriggerRule, evt: AvatarEvent, userMessageCount: number): boolean {
  switch (rule.kind) {
    case 'manual':
      return evt.type === 'manual' && evt.animationId === rule.animationId;
    case 'api':
      return evt.type === 'api' && evt.animationId === rule.animationId;
    case 'conversationEvent':
      return evt.type === 'conversation' && evt.event === rule.event;
    case 'everyNMessages':
      return evt.type === 'userMessage' && rule.n > 0 && userMessageCount % rule.n === 0;
    case 'textMatch': {
      if (evt.type !== (rule.target === 'assistant' ? 'assistantMessage' : 'userMessage')) return false;
      return matchText(evt.text, rule.mode, rule.patterns, rule.caseSensitive ?? false);
    }
    default:
      return false; // timer/randomInterval/shortcut run outside the bus
  }
}

export function matchText(
  text: string,
  mode: 'contains' | 'regex' | 'startsWith' | 'endsWith' | 'keywords',
  patterns: string[],
  caseSensitive: boolean,
): boolean {
  const subject = caseSensitive ? text : text.toLowerCase();
  return patterns.some((raw) => {
    const p = caseSensitive ? raw : raw.toLowerCase();
    switch (mode) {
      case 'contains':
        return subject.includes(p);
      case 'startsWith':
        return subject.startsWith(p);
      case 'endsWith':
        return subject.trimEnd().endsWith(p);
      case 'keywords':
        // Whole-word match so 'hi' never fires inside 'this'.
        return new RegExp(`\\b${escapeRegExp(p)}\\b`, caseSensitive ? '' : 'i').test(text);
      case 'regex':
        try {
          return new RegExp(raw, caseSensitive ? '' : 'i').test(text);
        } catch {
          return false;
        }
    }
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
