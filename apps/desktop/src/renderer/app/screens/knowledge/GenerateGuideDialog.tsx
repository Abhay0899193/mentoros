import { useEffect, useState } from 'react';
import { AlertCircle, Check, Sparkles } from 'lucide-react';
import { Overlay, Button, Chip, Spinner } from '../../../ui';
import { useKb } from '../../../lib/kbStore';

/**
 * "New guide ✨" (Phase G): a prompt writes ONE supplementary study-guide part
 * to STUDY-GUIDES/custom/<slug>.md and ingests it — never touches week guides.
 * Run state lives in kbStore, not here — closing this dialog mid-run leaves
 * generation going in the background; reopening shows wherever it got to.
 */

const MAX_PROMPT = 2000;

const EXAMPLE_PROMPTS = [
  'Bit manipulation tricks for interviews — XOR patterns, masks, counting bits',
  'System design: rate limiter — token bucket vs sliding window, storage choices',
  'Python heapq patterns: top-K, k-way merge, lazy deletion',
];

export function GenerateGuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guideRun = useKb((s) => s.guideRun);
  const generateGuide = useKb((s) => s.generateGuide);
  const resetGuideRun = useKb((s) => s.resetGuideRun);
  const openReading = useKb((s) => s.openReading);

  const [prompt, setPrompt] = useState('');

  // Seed the textarea from the last submitted prompt (e.g. after Retry lands
  // back on the compose form) — never overwrite while the user is typing fresh.
  useEffect(() => {
    if (open && guideRun.status === 'idle' && guideRun.prompt) setPrompt(guideRun.prompt);
  }, [open, guideRun.status, guideRun.prompt]);

  const running = guideRun.status === 'generating' || guideRun.status === 'ingesting';
  const trimmed = prompt.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_PROMPT && !running;

  const submit = () => {
    if (!canSubmit) return;
    void generateGuide(trimmed);
  };

  const retry = () => {
    const p = guideRun.prompt ?? trimmed;
    if (p) void generateGuide(p);
  };

  const openGuide = () => {
    if (guideRun.sourceId) openReading(guideRun.sourceId);
    resetGuideRun();
    onClose();
  };

  return (
    <Overlay open={open} onClose={onClose} width={560} align="top">
      <div className="flex flex-col gap-4 p-5">
        <header>
          <h2 className="text-h3 font-semibold text-ink">New guide</h2>
          <p className="mt-0.5 text-small text-muted">
            A supplementary study-guide part, written to order — it lands in Knowledge next to
            your imported plan's guides.
          </p>
        </header>

        {guideRun.status === 'idle' && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Prompt</span>
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this guide teach?"
                rows={4}
                maxLength={MAX_PROMPT}
                aria-label="Guide prompt"
                className="resize-none rounded-[10px] bg-surface-2 px-3 py-2.5 text-small leading-relaxed text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Try one</span>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <Chip
                    key={p}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPrompt(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPrompt(p);
                      }
                    }}
                    className="max-w-full cursor-default rounded-[10px] px-2.5 py-1.5 text-left text-small font-normal normal-case tracking-normal whitespace-normal hover:bg-surface-3"
                  >
                    {p}
                  </Chip>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-faint">
              Writes with your Guide writer model — change it in Settings → Models.
            </p>
          </>
        )}

        {running && (
          <div className="flex flex-col items-center gap-3 rounded-[10px] bg-surface-2 py-10 hairline">
            <Spinner className="size-5" />
            <p className="text-small text-body">
              {guideRun.status === 'generating'
                ? `Writing… ${guideRun.chars ?? 0} chars`
                : 'Adding to Knowledge…'}
            </p>
          </div>
        )}

        {guideRun.status === 'done' && (
          <div className="flex flex-col items-center gap-3 rounded-[10px] bg-surface-2 py-10 hairline">
            <div className="flex size-9 items-center justify-center rounded-full bg-success/10 text-success">
              <Check size={18} strokeWidth={1.5} />
            </div>
            <p className="text-small text-body">Guide written and added to Knowledge.</p>
          </div>
        )}

        {guideRun.status === 'error' && (
          <div className="flex flex-col items-center gap-3 rounded-[10px] bg-surface-2 px-5 py-10 hairline">
            <div className="flex size-9 items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertCircle size={18} strokeWidth={1.5} />
            </div>
            <p className="text-center text-small text-body">
              {guideRun.error ?? 'Something went wrong.'}
            </p>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-line pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              // A finished run is consumed on close so the next open starts fresh.
              if (guideRun.status === 'done') resetGuideRun();
              onClose();
            }}
          >
            {running ? 'Continue in background' : 'Close'}
          </Button>
          {guideRun.status === 'idle' && (
            <Button
              variant="primary"
              icon={<Sparkles size={14} strokeWidth={1.5} />}
              onClick={submit}
              disabled={!canSubmit}
            >
              Generate
            </Button>
          )}
          {guideRun.status === 'error' && (
            <Button variant="primary" icon={<Sparkles size={14} strokeWidth={1.5} />} onClick={retry}>
              Retry
            </Button>
          )}
          {guideRun.status === 'done' && (
            <Button variant="primary" onClick={openGuide}>
              Open guide
            </Button>
          )}
        </footer>
      </div>
    </Overlay>
  );
}
