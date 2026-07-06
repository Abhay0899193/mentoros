import { motion } from 'motion/react';
import { Circle, SmilePlus } from 'lucide-react';
import { useSettings } from '../../../lib/settingsStore';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { AppSettings } from '../../../lib/coreClient';
import { Panel } from '../../../ui';

const OPTIONS: { id: AppSettings['mentorIdentity']; label: string; icon: typeof Circle }[] = [
  { id: 'orb', label: 'Orb', icon: Circle },
  { id: 'face', label: 'Face', icon: SmilePlus },
];

/** Orb ↔ Face — mentor presence shown on the Voice screen. */
export function IdentitySection() {
  const settings = useSettings((s) => s.settings);
  const setMentorIdentity = useSettings((s) => s.setMentorIdentity);
  const current = settings?.mentorIdentity ?? 'orb';

  return (
    <Panel title="Mentor identity">
      <div className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="Mentor identity"
          className="relative inline-flex w-fit rounded-full bg-surface-2 p-1 hairline"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = current === opt.id;
            return (
              <button
                key={opt.id}
                role="radio"
                aria-checked={active}
                onClick={() => void setMentorIdentity(opt.id)}
                className={cn(
                  'relative z-10 flex h-8 w-24 items-center justify-center gap-1.5 rounded-full text-small font-medium',
                  active ? 'text-ink' : 'text-muted hover:text-body',
                )}
              >
                <Icon size={14} strokeWidth={1.5} />
                {opt.label}
                {active && (
                  <motion.span
                    layoutId="identity-indicator"
                    transition={spring.smooth}
                    className="absolute inset-0 -z-10 rounded-full bg-surface-3 hairline-strong"
                  />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-small text-muted">Face is shown on the Voice screen.</p>
      </div>
    </Panel>
  );
}
