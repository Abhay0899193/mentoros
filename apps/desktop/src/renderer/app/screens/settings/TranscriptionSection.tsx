import { motion, useReducedMotion } from 'motion/react';
import { Check, Download } from 'lucide-react';
import { useSettings } from '../../../lib/settingsStore';
import { spring, riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { SttModelInfo } from '../../../lib/coreClient';
import { Panel, Chip, Button } from '../../../ui';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
      <div className="size-4 shrink-0 animate-pulse rounded-full bg-surface-2" />
      <div className="h-3 w-32 animate-pulse rounded-full bg-surface-2" />
      <div className="ml-auto h-6 w-20 animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function ModelRow({ model }: { model: SttModelInfo }) {
  const settings = useSettings((s) => s.settings);
  const setSttModel = useSettings((s) => s.setSttModel);
  const downloadModel = useSettings((s) => s.downloadModel);
  const progress = useSettings((s) => s.downloadProgress[model.id]);

  const selected = settings?.sttModel === model.id;
  const pct =
    progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100)) : 0;

  return (
    <div
      role={model.state === 'ready' ? 'radio' : undefined}
      aria-checked={model.state === 'ready' ? selected : undefined}
      tabIndex={model.state === 'ready' ? 0 : undefined}
      onClick={() => {
        if (model.state === 'ready') void setSttModel(model.id);
      }}
      onKeyDown={(e) => {
        if (model.state === 'ready' && e.key === 'Enter') {
          e.preventDefault();
          void setSttModel(model.id);
        }
      }}
      className={cn(
        'flex flex-col gap-2 rounded-[10px] px-3 py-2.5 transition-colors duration-150',
        model.state === 'ready' && 'cursor-default hover:bg-surface-2 focus-visible:bg-surface-2',
        selected && 'bg-surface-2 ring-1 ring-iris/40',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full hairline',
            selected ? 'bg-iris/10 text-iris' : 'bg-surface-2 text-faint',
          )}
        >
          {selected && <Check size={12} strokeWidth={2} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-small font-medium text-ink">{model.label}</span>
            <span className="text-[12px] text-faint">{formatSize(model.sizeBytes)}</span>
            {model.active && <Chip tone="iris">Active</Chip>}
          </div>
          <p className="mt-0.5 text-[12px] text-muted">{model.note}</p>
        </div>

        {model.state === 'missing' && (
          <Button size="sm" onClick={(e) => { e.stopPropagation(); void downloadModel(model.id); }}>
            <Download size={13} strokeWidth={1.5} />
            Download
          </Button>
        )}
      </div>

      {model.state === 'downloading' && (
        <div className="flex items-center gap-2 pl-9">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-iris/70"
              animate={{ width: `${pct}%` }}
              transition={spring.smooth}
            />
          </div>
          <span className="w-9 shrink-0 text-right font-mono text-[11px] text-faint tabular">{pct}%</span>
        </div>
      )}
    </div>
  );
}

/** Transcription quality — whisper.cpp model ladder (§Settings). */
export function TranscriptionSection() {
  const sttModels = useSettings((s) => s.sttModels);
  const sttLoading = useSettings((s) => s.sttLoading);
  const sttError = useSettings((s) => s.sttError);
  const loadSttModels = useSettings((s) => s.loadSttModels);
  const settings = useSettings((s) => s.settings);
  const reduce = useReducedMotion();

  const selectedReady = sttModels.find((m) => m.id === settings?.sttModel)?.state === 'ready';
  const activeModel = sttModels.find((m) => m.active);

  return (
    <Panel title="Transcription quality">
      {sttLoading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : sttError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-small text-muted">{sttError}</p>
          <Button size="sm" onClick={() => void loadSttModels()}>
            Retry
          </Button>
        </div>
      ) : (
        <motion.div
          variants={reduced(reduce, staggerChildren)}
          initial="hidden"
          animate="visible"
          role="radiogroup"
          aria-label="Transcription model"
          className="flex flex-col gap-0.5"
        >
          {sttModels.map((m) => (
            <motion.div key={m.id} variants={reduced(reduce, riseIn)}>
              <ModelRow model={m} />
            </motion.div>
          ))}
          {!selectedReady && settings && activeModel && (
            <p className="px-3 pt-1 text-[12px] text-faint">
              Using {activeModel.label} until download finishes.
            </p>
          )}
        </motion.div>
      )}
    </Panel>
  );
}
