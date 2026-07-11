import { useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle } from 'lucide-react';
import { useSettings } from '../../../lib/settingsStore';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { Button } from '../../../ui';
import { AppearanceSection } from './AppearanceSection';
import { VoiceSection } from './VoiceSection';
import { ModelsSection } from './ModelsSection';
import { TranscriptionSection } from './TranscriptionSection';
import { IdentitySection } from './IdentitySection';
import { PersonasSection } from './PersonasSection';

function SectionSkeleton() {
  return (
    <div className="rounded-[14px] bg-surface-1 hairline p-4">
      <div className="mb-4 h-3 w-32 animate-pulse rounded-full bg-surface-2" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-[10px] bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

/** Settings (plan.md Phase-1 feedback slice): mentor voice, transcription, identity. */
export function SettingsScreen() {
  const init = useSettings((s) => s.init);
  const settings = useSettings((s) => s.settings);
  const settingsLoading = useSettings((s) => s.settingsLoading);
  const settingsError = useSettings((s) => s.settingsError);
  const loadSettings = useSettings((s) => s.loadSettings);
  const reduce = useReducedMotion();

  useEffect(() => init(), [init]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto px-6 py-8">
      <header>
        <h1 className="text-h2 text-ink">Settings</h1>
        <p className="mt-1 text-small text-muted">
          Tune how your mentor sounds, listens, and shows up — for Abhay's MentorOS.
        </p>
      </header>

      {settingsLoading && !settings ? (
        <div className="flex flex-col gap-5">
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : settingsError && !settings ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] bg-surface-1 hairline py-16 text-center">
          <AlertCircle size={26} strokeWidth={1.5} className="text-faint" />
          <div>
            <h2 className="text-h3 text-ink">Settings unavailable</h2>
            <p className="mx-auto mt-1 max-w-sm text-small text-muted">{settingsError}</p>
          </div>
          <Button size="sm" onClick={() => void loadSettings()}>
            Retry
          </Button>
        </div>
      ) : (
        <motion.div
          variants={reduced(reduce, staggerChildren)}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-5"
        >
          <motion.div variants={reduced(reduce, riseIn)}>
            <AppearanceSection />
          </motion.div>
          <motion.div variants={reduced(reduce, riseIn)}>
            <VoiceSection />
          </motion.div>
          <motion.div variants={reduced(reduce, riseIn)}>
            <ModelsSection />
          </motion.div>
          <motion.div variants={reduced(reduce, riseIn)}>
            <TranscriptionSection />
          </motion.div>
          <motion.div variants={reduced(reduce, riseIn)}>
            <IdentitySection />
          </motion.div>
          <motion.div variants={reduced(reduce, riseIn)}>
            <PersonasSection />
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
