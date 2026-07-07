import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Circle, SmilePlus } from 'lucide-react';
import { useSettings } from '../../../lib/settingsStore';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type {
  AppSettings,
  FaceGlam,
  FaceMaturity,
  FacePresetId,
  FaceView,
} from '../../../lib/coreClient';
import { Panel } from '../../../ui';
import { MentorFace } from '../../../orb/MentorFace';
import { FacePortrait } from '../../../orb/faces/FacePortrait';
import { FACE_PRESETS, FACE_PRESET_MAP } from '../../../orb/faces/presets';
import { RealisticPortrait } from '../../../orb/faces/RealisticPortrait';
import { REALISTIC_PRESETS, REALISTIC_PRESET_MAP } from '../../../orb/faces/realistic';

const IDENTITY_OPTIONS: { id: AppSettings['mentorIdentity']; label: string; icon: typeof Circle }[] = [
  { id: 'orb', label: 'Orb', icon: Circle },
  { id: 'face', label: 'Face', icon: SmilePlus },
];

const GLAM_OPTIONS: { id: FaceGlam; label: string }[] = [
  { id: 'natural', label: 'Natural' },
  { id: 'polished', label: 'Polished' },
  { id: 'glam', label: 'Glam' },
];

const MATURITY_OPTIONS: { id: FaceMaturity; label: string }[] = [
  { id: 'youthful', label: 'Youthful' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'mature', label: 'Mature' },
];

const VIEW_OPTIONS: { id: FaceView; label: string }[] = [
  { id: 'cameo', label: 'Cameo' },
  { id: 'full', label: 'Full body' },
];

const AURA_VIBE = 'The minimal face, living inside the Orb itself.';

/** Small segmented radio row reused for glam/maturity (monochrome chrome). */
function SegmentedRow<T extends string>({
  label,
  options,
  value,
  onChange,
  layoutId,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-label font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="relative inline-flex w-fit rounded-full bg-surface-2 p-1 hairline"
      >
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.id)}
              className={cn(
                'relative z-10 flex h-7 items-center justify-center rounded-full px-3.5 text-small font-medium',
                active ? 'text-ink' : 'text-muted hover:text-body',
              )}
            >
              {opt.label}
              {active && (
                <motion.span
                  layoutId={layoutId}
                  transition={spring.smooth}
                  className="absolute inset-0 -z-10 rounded-full bg-surface-3 hairline-strong"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mini "Aura" preview — the minimal MentorFace over a CSS aurora disc. */
function AuraThumb({ size }: { size: number }) {
  const levelRef = useRef(0);
  return (
    <div
      className="relative overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 38% 32%, hsl(248 70% 40% / 0.9) 0%, hsl(255 55% 22%) 46%, #0B0C12 100%)',
      }}
    >
      <div className="relative h-full w-full">
        <MentorFace state="idle" levelRef={levelRef} size={size} frozen />
      </div>
    </div>
  );
}

/** Orb ↔ Face gallery — mentor presence shown on the Voice screen. */
export function IdentitySection() {
  const settings = useSettings((s) => s.settings);
  const setMentorLook = useSettings((s) => s.setMentorLook);
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<FacePresetId | null>(null);
  const previewLevel = useRef(0);

  const identity = settings?.mentorIdentity ?? 'orb';
  const faceId = settings?.mentorFace ?? 'aura';
  const glam = settings?.faceGlam ?? 'polished';
  const maturity = settings?.faceMaturity ?? 'balanced';
  const view = settings?.faceView ?? 'cameo';
  const selected = FACE_PRESET_MAP[faceId];
  const selectedRealistic = REALISTIC_PRESET_MAP[faceId];

  return (
    <Panel title="Mentor identity">
      <div className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label="Mentor identity"
          className="relative inline-flex w-fit rounded-full bg-surface-2 p-1 hairline"
        >
          {IDENTITY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = identity === opt.id;
            return (
              <button
                key={opt.id}
                role="radio"
                aria-checked={active}
                onClick={() => void setMentorLook({ mentorIdentity: opt.id })}
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

        {identity === 'face' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.gentle}
            className="flex flex-wrap items-start gap-6"
          >
            {/* live preview of the current look */}
            <div className="flex w-[220px] shrink-0 flex-col items-center gap-3">
              {selectedRealistic ? (
                <RealisticPortrait
                  key={`${selectedRealistic.id}-${view}`}
                  preset={selectedRealistic}
                  state="idle"
                  levelRef={previewLevel}
                  size={200}
                  view={view}
                  frozen={!!reduce}
                />
              ) : selected ? (
                <FacePortrait
                  key={`${selected.id}-${glam}-${maturity}`}
                  preset={selected}
                  glam={glam}
                  maturity={maturity}
                  state="idle"
                  levelRef={previewLevel}
                  size={200}
                  frozen={!!reduce}
                />
              ) : (
                <AuraThumb size={200} />
              )}
              <div className="text-center">
                <div className="text-h3 font-semibold text-ink">
                  {selectedRealistic?.name ?? selected?.name ?? 'Aura'}
                </div>
                <p className="mt-0.5 text-small text-muted">
                  {selectedRealistic?.vibe ?? selected?.vibe ?? AURA_VIBE}
                </p>
              </div>
            </div>

            <div className="flex min-w-[320px] flex-1 flex-col gap-4">
              {/* preset gallery — stylized art, then the realistic stills */}
              <div className="flex flex-col gap-1.5">
                <span className="text-label font-medium uppercase tracking-wide text-muted">
                  Stylized
                </span>
                <div role="radiogroup" aria-label="Stylized face preset" className="flex flex-wrap gap-2.5">
                  {[null, ...FACE_PRESETS].map((preset) => {
                    const pid: FacePresetId = preset?.id ?? 'aura';
                    const active = faceId === pid;
                    return (
                      <button
                        key={pid}
                        role="radio"
                        aria-checked={active}
                        onClick={() => void setMentorLook({ mentorFace: pid })}
                        onMouseEnter={() => setHovered(pid)}
                        onMouseLeave={() => setHovered((h) => (h === pid ? null : h))}
                        className={cn(
                          'group flex w-[104px] flex-col items-center gap-1.5 rounded-lg bg-surface-2 p-2.5 pb-2 hairline transition-colors',
                          active
                            ? 'hairline-strong bg-surface-3 outline outline-2 outline-offset-2 outline-[var(--iris)]'
                            : 'hover:bg-surface-3',
                        )}
                      >
                        {preset ? (
                          <FacePortrait
                            preset={preset}
                            glam={glam}
                            maturity={maturity}
                            state="idle"
                            size={80}
                            frozen={!!reduce || hovered !== pid}
                          />
                        ) : (
                          <AuraThumb size={80} />
                        )}
                        <span
                          className={cn(
                            'text-small font-medium',
                            active ? 'text-ink' : 'text-muted group-hover:text-body',
                          )}
                        >
                          {preset?.name ?? 'Aura'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-label font-medium uppercase tracking-wide text-muted">
                  Realistic
                </span>
                <div role="radiogroup" aria-label="Realistic face preset" className="flex flex-wrap gap-2.5">
                  {REALISTIC_PRESETS.map((preset) => {
                    const active = faceId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        role="radio"
                        aria-checked={active}
                        onClick={() => void setMentorLook({ mentorFace: preset.id })}
                        className={cn(
                          'group flex w-[104px] flex-col items-center gap-1.5 rounded-lg bg-surface-2 p-2.5 pb-2 hairline transition-colors',
                          active
                            ? 'hairline-strong bg-surface-3 outline outline-2 outline-offset-2 outline-[var(--iris)]'
                            : 'hover:bg-surface-3',
                        )}
                      >
                        <img
                          src={preset.portrait.base}
                          alt=""
                          draggable={false}
                          className="h-20 w-20 rounded-full object-cover"
                        />
                        <span
                          className={cn(
                            'text-small font-medium',
                            active ? 'text-ink' : 'text-muted group-hover:text-body',
                          )}
                        >
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* style dimensions — morphs for stylized art, framing for realistic */}
              {selectedRealistic ? (
                <div className="flex flex-col gap-2.5">
                  <SegmentedRow
                    label="View"
                    options={VIEW_OPTIONS}
                    value={view}
                    onChange={(v) => void setMentorLook({ faceView: v })}
                    layoutId="face-view-indicator"
                  />
                  <p className="text-small text-muted">
                    Realistic presets are fixed looks — styling is part of the portrait itself.
                  </p>
                </div>
              ) : selected ? (
                <div className="flex flex-col gap-2.5">
                  <SegmentedRow
                    label="Styling"
                    options={GLAM_OPTIONS}
                    value={glam}
                    onChange={(v) => void setMentorLook({ faceGlam: v })}
                    layoutId="face-glam-indicator"
                  />
                  <SegmentedRow
                    label="Presence"
                    options={MATURITY_OPTIONS}
                    value={maturity}
                    onChange={(v) => void setMentorLook({ faceMaturity: v })}
                    layoutId="face-maturity-indicator"
                  />
                </div>
              ) : (
                <p className="text-small text-muted">
                  Aura keeps the Orb as the face — styling options apply to the portraits.
                </p>
              )}
            </div>
          </motion.div>
        )}

        <p className="text-small text-muted">
          {identity === 'face'
            ? 'Your mentor wears this face on the Voice screen — it lip-syncs as she speaks.'
            : 'The Orb is the default mentor presence on the Voice screen.'}
        </p>
      </div>
    </Panel>
  );
}
