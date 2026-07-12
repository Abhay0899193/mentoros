import { motion, useReducedMotion } from 'motion/react';
import { Play, Square, Check, AudioLines } from 'lucide-react';
import { useSettings } from '../../../lib/settingsStore';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { TtsVoiceInfo } from '../../../lib/coreClient';
import { Panel, Chip, Spinner, Button } from '../../../ui';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
      <div className="size-7 shrink-0 animate-pulse rounded-full bg-surface-2" />
      <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
      <div className="ml-auto h-5 w-14 animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}

function VoiceRow({ voice }: { voice: TtsVoiceInfo }) {
  const settings = useSettings((s) => s.settings);
  const setVoice = useSettings((s) => s.setVoice);
  const previewingVoiceId = useSettings((s) => s.previewingVoiceId);
  const previewLoadingId = useSettings((s) => s.previewLoadingId);
  const previewErrorId = useSettings((s) => s.previewErrorId);
  const previewVoice = useSettings((s) => s.previewVoice);
  const stopPreview = useSettings((s) => s.stopPreview);

  const selected = settings?.ttsVoice === voice.id;
  const isPlaying = previewingVoiceId === voice.id;
  const isLoading = previewLoadingId === voice.id;
  const hasError = previewErrorId === voice.id;

  function togglePreview(e: React.SyntheticEvent) {
    e.stopPropagation();
    if (isPlaying || isLoading) stopPreview();
    else previewVoice(voice.id);
  }

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={() => void setVoice(voice.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void setVoice(voice.id);
        } else if (e.key === ' ') {
          e.preventDefault();
          togglePreview(e);
        }
      }}
      className={cn(
        'flex cursor-default items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150',
        'hover:bg-surface-2 focus-visible:bg-surface-2',
        selected && 'bg-surface-2 ring-1 ring-iris/40',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full hairline',
          selected ? 'bg-iris/10 text-iris' : 'bg-surface-2 text-muted',
        )}
      >
        {selected ? <Check size={14} strokeWidth={2} /> : <AudioLines size={14} strokeWidth={1.5} />}
      </span>

      <span className="min-w-0 flex-1 text-small font-medium text-ink">{voice.label}</span>

      <Chip tone="neutral" className="shrink-0">
        {voice.gender === 'female' ? 'Female' : 'Male'}
      </Chip>

      {hasError && <span className="shrink-0 text-[11px] text-faint">Preview unavailable</span>}

      <button
        aria-label={isPlaying ? `Stop preview of ${voice.label}` : `Play preview of ${voice.label}`}
        onClick={togglePreview}
        className="tap-target flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
      >
        {isLoading ? (
          <Spinner className="size-3.5 border-line-strong border-t-muted" />
        ) : isPlaying ? (
          <Square size={12} strokeWidth={1.5} fill="currentColor" />
        ) : (
          <Play size={12} strokeWidth={1.5} fill="currentColor" />
        )}
      </button>
    </div>
  );
}

/** Voice options grouped by accent — §Settings, mentor voice (Kokoro TTS). */
export function VoiceSection() {
  const voices = useSettings((s) => s.voices);
  const voicesLoading = useSettings((s) => s.voicesLoading);
  const voicesError = useSettings((s) => s.voicesError);
  const loadVoices = useSettings((s) => s.loadVoices);
  const reduce = useReducedMotion();

  const american = voices.filter((v) => v.accent === 'american');
  const british = voices.filter((v) => v.accent === 'british');

  return (
    <Panel title="Mentor voice">
      {voicesLoading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : voicesError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-small text-muted">{voicesError}</p>
          <Button size="sm" onClick={() => void loadVoices()}>
            Retry
          </Button>
        </div>
      ) : voices.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <p className="text-small font-medium text-ink">No mentor voices installed</p>
          <p className="text-small text-muted">Install voice in Voice Mode first.</p>
        </div>
      ) : (
        <motion.div
          variants={reduced(reduce, staggerChildren)}
          initial="hidden"
          animate="visible"
          role="radiogroup"
          aria-label="Mentor voice"
          className="flex flex-col gap-4"
        >
          {american.length > 0 && (
            <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-0.5">
              <h4 className="px-3 pb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">American</h4>
              {american.map((v) => (
                <VoiceRow key={v.id} voice={v} />
              ))}
            </motion.div>
          )}
          {british.length > 0 && (
            <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-0.5">
              <h4 className="px-3 pb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">British</h4>
              {british.map((v) => (
                <VoiceRow key={v.id} voice={v} />
              ))}
            </motion.div>
          )}
        </motion.div>
      )}
    </Panel>
  );
}
