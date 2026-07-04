import { PlugZap, Download, RefreshCw } from 'lucide-react';
import { useChat } from '../../../lib/chatStore';
import { Button, Card } from '../../../ui';

function formatBytes(n: number): string {
  if (n <= 0) return '0 MB';
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

/** Degraded states (§4.2): offline is designed, explains itself, offers a next action. */
export function ModelBanner() {
  const { modelStatus, pull, refreshModelStatus, startPull } = useChat();

  if (!modelStatus || modelStatus.state === 'ready') return null;

  const offline = modelStatus.state === 'ollama-offline';
  const pulling = pull?.active === true;
  const pct =
    pulling && pull.totalBytes > 0
      ? Math.min(100, Math.round((pull.completedBytes / pull.totalBytes) * 100))
      : 0;

  return (
    <Card padding="compact" className="flex items-start gap-3 border-warning/20">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-warning/10">
        {offline ? (
          <PlugZap size={16} strokeWidth={1.5} className="text-warning" />
        ) : (
          <Download size={16} strokeWidth={1.5} className="text-warning" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-small font-medium text-ink">
          {offline ? 'Ollama isn’t running' : `Model ${modelStatus.model} isn’t pulled yet`}
        </h3>
        <p className="mt-0.5 text-small text-muted">
          {offline
            ? 'MentorOS thinks locally — start Ollama and your mentor is back, no internet needed.'
            : 'One-time download; after this the mentor works fully offline.'}
        </p>
        {pulling && (
          <div className="mt-2">
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="aurora-bg h-full rounded-full transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-faint tabular">
              {formatBytes(pull.completedBytes)} / {formatBytes(pull.totalBytes)} · {pct}%
            </p>
          </div>
        )}
        {pull?.error && <p className="mt-1 text-small text-danger">{pull.error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {offline ? (
          <Button size="sm" icon={<RefreshCw size={14} strokeWidth={1.5} />} onClick={() => void refreshModelStatus()}>
            Check again
          </Button>
        ) : (
          !pulling && (
            <Button size="sm" variant="primary" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => void startPull()}>
              Pull model
            </Button>
          )
        )}
      </div>
    </Card>
  );
}
