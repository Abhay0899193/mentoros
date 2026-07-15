import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, RefreshCw } from 'lucide-react';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { useSettings } from '../../../lib/settingsStore';
import { CoreRequestError, type CustomEndpointInfo, type EndpointAuth, type EndpointKind } from '../../../lib/coreClient';
import { Overlay, Button } from '../../../ui';

const KIND_OPTIONS: { id: EndpointKind; label: string }[] = [
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'anthropic', label: 'Anthropic-compatible' },
];

const AUTH_OPTIONS: { id: EndpointAuth; label: string }[] = [
  { id: 'bearer', label: 'Bearer' },
  { id: 'x-api-key', label: 'x-api-key' },
];

interface QuickFill {
  label: string;
  kind: EndpointKind;
  baseUrl: string;
  auth: EndpointAuth;
}

const QUICK_FILLS: { label: string; fill: QuickFill }[] = [
  {
    label: 'OpenCode Zen',
    fill: { label: 'OpenCode Zen', kind: 'openai', baseUrl: 'https://opencode.ai/zen/v1', auth: 'bearer' },
  },
  {
    label: 'Org Claude gateway',
    fill: { label: 'Org Claude', kind: 'anthropic', baseUrl: '', auth: 'bearer' },
  },
];

const FIELD =
  'h-9 w-full rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris)] disabled:opacity-50';
const TEXTAREA = cn(FIELD, 'h-auto min-h-24 w-full resize-y rounded-[10px] py-2 leading-relaxed font-mono text-[12px]');

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
        {label}
        {hint && <span className="ml-1 normal-case text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({
  layoutId,
  options,
  value,
  onChange,
  ariaLabel,
}: {
  layoutId: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="relative inline-flex w-full rounded-full bg-surface-2 p-1 hairline">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'tap-target relative z-10 flex h-7 flex-1 items-center justify-center rounded-full px-2 text-small font-medium',
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
  );
}

/**
 * Create/edit dialog for a custom LLM endpoint (org gateway, OpenCode Zen,
 * self-hosted proxy…). `open` drives the Overlay's mount so it can play its
 * exit spring; `existing` is undefined in create mode.
 */
export function EndpointDialog({
  open,
  existing,
  onClose,
}: {
  open: boolean;
  existing?: CustomEndpointInfo;
  onClose: () => void;
}) {
  const createEndpoint = useSettings((s) => s.createEndpoint);
  const updateEndpoint = useSettings((s) => s.updateEndpoint);
  const testEndpoint = useSettings((s) => s.testEndpoint);
  const fetchEndpointModels = useSettings((s) => s.fetchEndpointModels);
  const endpointSaving = useSettings((s) => s.endpointSaving);

  const editing = existing ?? null;

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<EndpointKind>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [auth, setAuth] = useState<EndpointAuth>('bearer');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [modelsText, setModelsText] = useState('');

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const labelRef = useRef<HTMLInputElement>(null);

  // Reset (or prefill for edit) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFetchError(null);
    setTestResult(null);
    setClearToken(false);
    setToken('');
    if (editing) {
      setLabel(editing.label);
      setKind(editing.kind);
      setBaseUrl(editing.baseUrl);
      setAuth(editing.auth);
      setModelsText(editing.models.join('\n'));
    } else {
      setLabel('');
      setKind('openai');
      setBaseUrl('');
      setAuth('bearer');
      setModelsText('');
    }
    const t = setTimeout(() => labelRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function applyQuickFill(fill: QuickFill) {
    setLabel(fill.label);
    setKind(fill.kind);
    setBaseUrl(fill.baseUrl);
    setAuth(fill.auth);
  }

  const models = modelsText
    .split('\n')
    .map((m) => m.trim())
    .filter(Boolean);

  const saveDisabled = endpointSaving || label.trim() === '' || baseUrl.trim() === '';

  async function handleSave() {
    const patch = {
      label: label.trim(),
      kind,
      baseUrl: baseUrl.trim(),
      auth,
      models,
      ...(clearToken ? { token: '' } : token.trim() ? { token: token.trim() } : {}),
    };
    const result = editing ? await updateEndpoint(editing.id, patch) : await createEndpoint(patch);
    if (result) onClose();
  }

  async function handleFetchModels() {
    if (!editing || fetching) return;
    setFetching(true);
    setFetchError(null);
    try {
      const fetched = await fetchEndpointModels(editing.id);
      setModelsText(fetched.join('\n'));
    } catch (err) {
      setFetchError(err instanceof CoreRequestError ? err.message : 'Could not reach the endpoint.');
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!editing || testing) return;
    setTesting(true);
    setTestResult(null);
    const result = await testEndpoint(editing.id);
    setTestResult(result);
    setTesting(false);
  }

  const tokenPlaceholder = clearToken
    ? 'Token will be cleared on save'
    : editing?.tokenMask
      ? editing.tokenMask
      : editing
        ? 'no token set — leave blank to stay keyless'
        : 'leave empty for keyless/local endpoints';

  return (
    <Overlay open={open} onClose={onClose} width={560} align="center" className="flex max-h-[85vh] w-full flex-col">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-h3 text-ink">{editing ? `Edit ${editing.label}` : 'New custom endpoint'}</h2>
        <p className="mt-0.5 text-small text-muted">
          Any OpenAI- or Anthropic-compatible API — org gateways, OpenCode Zen, LM Studio…
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {!editing && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_FILLS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => applyQuickFill(q.fill)}
                className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 hairline px-2.5 py-1 text-[12px] text-body hover:bg-surface-3 hover:text-ink"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        <Field label="Label">
          <input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Org Claude gateway"
            className={FIELD}
          />
        </Field>

        <Field label="Kind">
          <Segmented
            layoutId="endpoint-kind-indicator"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            ariaLabel="Endpoint kind"
          />
        </Field>

        <Field label="Base URL">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://opencode.ai/zen/v1"
            spellCheck={false}
            className={cn(FIELD, 'font-mono text-[12px]')}
          />
        </Field>

        <Field label="Auth scheme">
          <Segmented
            layoutId="endpoint-auth-indicator"
            options={AUTH_OPTIONS}
            value={auth}
            onChange={setAuth}
            ariaLabel="Auth scheme"
          />
          <p className="mt-1 text-[11px] text-faint">
            Bearer covers most gateways (Authorization header); x-api-key mimics Anthropic&rsquo;s own header.
          </p>
        </Field>

        <Field label="Token" hint={editing ? undefined : '(optional)'}>
          <div className="flex items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (e.target.value) setClearToken(false);
              }}
              disabled={clearToken}
              placeholder={tokenPlaceholder}
              className={FIELD}
            />
            {editing?.tokenMask && (
              <button
                type="button"
                onClick={() => {
                  setClearToken((v) => !v);
                  setToken('');
                }}
                className="tap-target shrink-0 text-[12px] font-medium text-faint hover:text-body"
              >
                {clearToken ? 'Keep token' : 'Remove token'}
              </button>
            )}
          </div>
          {editing?.tokenMask && !clearToken && (
            <p className="mt-1 text-[11px] text-faint">Leave blank to keep the current token.</p>
          )}
        </Field>

        <Field label="Models" hint="(one model id per line)">
          <textarea
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder={'gpt-4o\no1\ndeepseek-v3'}
            rows={4}
            className={TEXTAREA}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={12} strokeWidth={1.5} />}
              loading={fetching}
              loadingLabel="Fetching…"
              disabled={!editing}
              title={!editing ? 'Save first, then fetch' : undefined}
              onClick={() => void handleFetchModels()}
            >
              Fetch from endpoint
            </Button>
            {fetchError && <p className="text-[11px] text-danger">{fetchError}</p>}
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <div className="flex items-center gap-2">
          {editing && (
            <Button size="sm" variant="ghost" loading={testing} loadingLabel="Testing…" onClick={() => void handleTest()}>
              Test
            </Button>
          )}
          {testResult &&
            (testResult.ok ? (
              <span className="flex items-center gap-1 text-[12px] text-success">
                <Check size={12} strokeWidth={2} /> Reachable
              </span>
            ) : (
              <span className="text-[12px] text-danger">{testResult.error ?? 'Could not reach the endpoint.'}</span>
            ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={endpointSaving}
            loadingLabel="Saving…"
            disabled={saveDisabled}
            onClick={() => void handleSave()}
          >
            {editing ? 'Save changes' : 'Create endpoint'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
