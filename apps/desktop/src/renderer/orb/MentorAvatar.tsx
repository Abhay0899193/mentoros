import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { coreClient, type AppSettings } from '../lib/coreClient';
import { OrbCanvas, type OrbCanvasProps } from './OrbCanvas';
import { MentorFace } from './MentorFace';
import { FacePortrait } from './faces/FacePortrait';
import { FACE_PRESET_MAP } from './faces/presets';
import { ORB_HUE } from './orbState';

/**
 * MentorAvatar — the Orb, optionally wearing the mentor's face
 * (Settings → Mentor identity). 'aura' keeps the minimal face as an overlay
 * on the living Orb; portrait presets render the FacePortrait cameo, which
 * carries the same state hues/audio reactivity so the one-living-element
 * rule (§3.0.3) holds in every identity.
 */

type MentorLook = Pick<AppSettings, 'mentorIdentity' | 'mentorFace' | 'faceGlam' | 'faceMaturity'>;

let cachedLook: MentorLook = {
  mentorIdentity: 'orb',
  mentorFace: 'aura',
  faceGlam: 'polished',
  faceMaturity: 'balanced',
};

function pickLook(s: AppSettings): MentorLook {
  return {
    mentorIdentity: s.mentorIdentity,
    mentorFace: s.mentorFace,
    faceGlam: s.faceGlam,
    faceMaturity: s.faceMaturity,
  };
}

function useMentorLook(): MentorLook {
  const [look, setLook] = useState(cachedLook);
  useEffect(() => {
    let alive = true;
    coreClient
      .getSettings()
      .then((s) => {
        cachedLook = pickLook(s);
        if (alive) setLook(cachedLook);
      })
      .catch(() => undefined); // pre-migration core: stay on the orb
    const off = coreClient.on('settings.changed', ({ settings }) => {
      cachedLook = pickLook(settings);
      setLook(cachedLook);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return look;
}

export function MentorAvatar(props: OrbCanvasProps) {
  const look = useMentorLook();
  const reduce = useReducedMotion();
  const size = props.size ?? 340;
  const portrait = look.mentorIdentity === 'face' ? FACE_PRESET_MAP[look.mentorFace] : undefined;

  if (look.mentorIdentity !== 'face') return <OrbCanvas {...props} />;

  if (portrait) {
    const hue = ORB_HUE[props.state];
    return (
      <button
        aria-label={`${portrait.name} — ${props.state}. Tap to interrupt.`}
        onClick={props.onTap}
        className="relative cursor-default"
        style={{ width: size, height: size }}
      >
        {/* ambient glow behind the cameo — same treatment as the Orb */}
        <div
          aria-hidden
          className="absolute inset-[-18%] rounded-full transition-opacity duration-700"
          style={{
            background: `radial-gradient(circle, hsl(${hue} 85% 62% / 0.24) 0%, transparent 62%)`,
            filter: 'blur(28px)',
          }}
        />
        <div className="relative">
          <FacePortrait
            preset={portrait}
            glam={look.faceGlam}
            maturity={look.faceMaturity}
            state={props.state}
            levelRef={props.levelRef}
            size={size}
            frozen={!!reduce}
          />
        </div>
      </button>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <OrbCanvas {...props} />
      <MentorFace state={props.state} levelRef={props.levelRef} size={size} frozen={!!reduce} />
    </div>
  );
}
