import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { coreClient } from '../lib/coreClient';
import { OrbCanvas, type OrbCanvasProps } from './OrbCanvas';
import { MentorFace } from './MentorFace';

/**
 * MentorAvatar — the Orb, optionally wearing the mentor's face
 * (Settings → Mentor identity). The face is an overlay on the same living
 * Orb, so state colors, audio reactivity, and the reduced-motion fallback
 * all keep working identically in both identities.
 */

let cachedIdentity: 'orb' | 'face' = 'orb';

function useMentorIdentity(): 'orb' | 'face' {
  const [identity, setIdentity] = useState(cachedIdentity);
  useEffect(() => {
    let alive = true;
    coreClient
      .getSettings()
      .then((s) => {
        cachedIdentity = s.mentorIdentity;
        if (alive) setIdentity(s.mentorIdentity);
      })
      .catch(() => undefined); // pre-migration core: stay on the orb
    const off = coreClient.on('settings.changed', ({ settings }) => {
      cachedIdentity = settings.mentorIdentity;
      setIdentity(settings.mentorIdentity);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return identity;
}

export function MentorAvatar(props: OrbCanvasProps) {
  const identity = useMentorIdentity();
  const reduce = useReducedMotion();
  const size = props.size ?? 340;

  if (identity !== 'face') return <OrbCanvas {...props} />;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <OrbCanvas {...props} />
      <MentorFace state={props.state} levelRef={props.levelRef} size={size} frozen={!!reduce} />
    </div>
  );
}
