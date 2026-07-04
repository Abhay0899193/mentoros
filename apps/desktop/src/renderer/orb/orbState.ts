/**
 * Voice-loop state machine — OWNED BY THE LEAD AGENT (plan approved: Fable
 * owns choreography; core owns audio plumbing beneath it).
 *
 * The Orb mirrors these states 1:1 (§4.3):
 *   idle      — breathing, Aurora hue drift
 *   listening — mic-reactive ripples, hue → cyan
 *   thinking  — tighter churn, hue → violet
 *   speaking  — TTS-envelope pulse, hue → iris, glow intensifies
 *
 * Pure and framework-free so it is unit-testable and reusable by both the
 * Voice screen and the floating Orb dock.
 */

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VoiceEvent =
  | { type: 'PTT_DOWN' } // push-to-talk pressed (or wake word)
  | { type: 'PTT_UP' } // released → finalize transcript, start generation
  | { type: 'SPEECH_ONSET' } // VAD detected user speech (drives barge-in)
  | { type: 'GENERATION_STARTED' }
  | { type: 'TTS_STARTED' }
  | { type: 'TTS_ENDED' }
  | { type: 'CANCEL' } // esc / tap-to-interrupt
  | { type: 'ERROR' };

export function transition(state: OrbState, event: VoiceEvent): OrbState {
  switch (event.type) {
    case 'PTT_DOWN':
      return 'listening';
    case 'PTT_UP':
      return state === 'listening' ? 'thinking' : state;
    case 'SPEECH_ONSET':
      // Barge-in (§4.3): user talks over the mentor → duck TTS, listen.
      return state === 'speaking' ? 'listening' : state;
    case 'GENERATION_STARTED':
      return 'thinking';
    case 'TTS_STARTED':
      return 'speaking';
    case 'TTS_ENDED':
      return state === 'speaking' ? 'idle' : state;
    case 'CANCEL':
    case 'ERROR':
      return 'idle';
  }
}

/** Hue targets per state (degrees on the Aurora wheel) — single source of truth
 * for both the shader Orb and the CSS fallback. */
export const ORB_HUE: Record<OrbState, number> = {
  idle: 248, // iris-violet drift base
  listening: 187, // cyan
  thinking: 268, // violet
  speaking: 240, // iris
};

/** Motion intensity per state, 0..1 — scales displacement/pulse amplitude. */
export const ORB_ENERGY: Record<OrbState, number> = {
  idle: 0.25,
  listening: 0.7,
  thinking: 0.55,
  speaking: 0.85,
};
