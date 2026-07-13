import { useState } from 'react';
import { CheckCircle2, ClipboardPaste } from 'lucide-react';
import { Overlay, Button } from '../../../ui';
import { useLearning } from '../../../lib/learningStore';
import type { ProgressImportResult } from '../../../lib/coreClient';

/**
 * Paste-import for the 3-month-challenge study-ui progress. That app keeps
 * completion in the browser's localStorage (`study-progress`) with the same
 * task ids our plan import uses, so one paste maps straight onto the path.
 */
export function ImportProgressDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const importProgress = useLearning((s) => s.importProgress);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProgressImportResult | null>(null);

  function close() {
    setRaw('');
    setError(null);
    setResult(null);
    onClose();
  }

  async function run() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
      // `copy(localStorage.getItem(…))` pastes the object directly, but a
      // stringified-twice paste (quotes around the whole thing) parses to a
      // string — unwrap it once.
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    } catch {
      setError('That doesn’t parse as JSON — paste exactly what the copy command put on your clipboard.');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('No progress found in the paste — expected the study-progress object.');
      return;
    }
    setBusy(true);
    try {
      setResult(await importProgress(parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed — is the core running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay open={open} onClose={close} width={560} align="top">
      <div className="flex flex-col gap-4 p-5">
        <header>
          <h2 className="text-h3 font-semibold text-ink">Import progress from 3-month-challenge</h2>
          <p className="mt-0.5 text-small text-muted">
            The study app keeps your checkmarks in that browser only. Bring them over once — nothing
            here is ever un-done by an import, and your original completion dates are kept.
          </p>
        </header>

        {result ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-[10px] bg-surface-2 p-4">
              <CheckCircle2 size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-success" />
              <div className="text-small text-body">
                <p className="text-ink">
                  {result.applied} task{result.applied === 1 ? '' : 's'} marked done.
                </p>
                <p className="mt-1 text-muted">
                  {result.alreadyDone > 0 && <>{result.alreadyDone} already done here · </>}
                  {result.unknown > 0 && <>{result.unknown} not in the imported plan · </>}
                  {result.found} completed entr{result.found === 1 ? 'y' : 'ies'} in the paste.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-small text-body">
              <li>
                Open the study app in the browser you used it in (usually{' '}
                <span className="font-mono text-[13px]">localhost:3000</span>).
              </li>
              <li>
                Open the DevTools console (<span className="font-mono text-[13px]">⌥⌘J</span>) and run{' '}
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] break-all">
                  copy(localStorage.getItem('study-progress'))
                </span>
              </li>
              <li>Paste the result below.</li>
            </ol>

            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder='{"phase-1-week-1-day-1-lc-1":{"completed":true,"date":"2026-05-04"}, …}'
              spellCheck={false}
              className="h-36 w-full resize-y rounded-[10px] bg-surface-2 p-3 font-mono text-[13px] text-ink outline-none hairline placeholder:text-faint focus:ring-1 focus:ring-iris/40"
            />

            {error && <p className="text-small text-danger">{error}</p>}

            <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<ClipboardPaste size={15} strokeWidth={1.5} />}
                loading={busy}
                loadingLabel="Importing…"
                disabled={!raw.trim()}
                onClick={() => void run()}
              >
                Import progress
              </Button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
