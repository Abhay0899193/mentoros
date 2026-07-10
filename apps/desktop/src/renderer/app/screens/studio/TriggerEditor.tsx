import { useMemo, useState } from 'react';
import { Overlay, Button } from '../../../ui';
import { cn } from '../../../lib/cn';
import type {
  AnimationClip,
  ConversationEvent,
  TextMatchMode,
  TriggerRule,
} from '../../../lib/coreClient';

/**
 * TriggerEditor — one rule: when should a clip play. Kind picker + the few
 * fields that kind needs; validation mirrors core's (regex compile, ranges)
 * so a 422 never surprises the user.
 */

const KINDS: { id: TriggerRule['kind']; label: string; hint: string }[] = [
  { id: 'conversationEvent', label: 'Conversation moment', hint: 'a voice-loop transition (starts speaking, goes idle…)' },
  { id: 'textMatch', label: 'Message text', hint: 'a chat/voice message matches a pattern' },
  { id: 'randomInterval', label: 'Random interval', hint: 'every so often, at a random beat (blinks live here)' },
  { id: 'timer', label: 'Timer', hint: 'every N seconds, exactly' },
  { id: 'everyNMessages', label: 'Every Nth message', hint: 'after every Nth thing you send' },
  { id: 'shortcut', label: 'Keyboard shortcut', hint: 'a key chord plays it anywhere in the app' },
  { id: 'manual', label: 'Manual', hint: 'only when you press Play' },
  { id: 'api', label: 'API', hint: 'played programmatically (playAvatarAnimation)' },
];

const EVENTS: ConversationEvent[] = [
  'conversationStarted',
  'conversationEnded',
  'listening',
  'thinking',
  'speakingStarted',
  'speakingEnded',
  'idle',
  'silenceTimeout',
];

const MATCH_MODES: TextMatchMode[] = ['keywords', 'contains', 'startsWith', 'endsWith', 'regex'];

function ruleId(taken: Set<string>): string {
  let n = 1;
  while (taken.has(`rule-${n}`)) n += 1;
  return `rule-${n}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-label font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

const inputCls =
  'h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong';
const selectCls = cn(inputCls, 'pr-8');

export interface TriggerEditorProps {
  open: boolean;
  /** Null = new rule. */
  rule: TriggerRule | null;
  clips: AnimationClip[];
  takenIds: string[];
  onSave: (rule: TriggerRule) => void;
  onClose: () => void;
}

export function TriggerEditor({ open, rule, clips, takenIds, onSave, onClose }: TriggerEditorProps) {
  const [kind, setKind] = useState<TriggerRule['kind']>(rule?.kind ?? 'conversationEvent');
  const [animationId, setAnimationId] = useState(rule?.animationId ?? clips[0]?.id ?? '');
  const [event, setEvent] = useState<ConversationEvent>(
    rule?.kind === 'conversationEvent' ? rule.event : 'speakingStarted',
  );
  const [mode, setMode] = useState<TextMatchMode>(rule?.kind === 'textMatch' ? rule.mode : 'keywords');
  const [target, setTarget] = useState<'assistant' | 'user'>(rule?.kind === 'textMatch' ? rule.target : 'user');
  const [patterns, setPatterns] = useState(rule?.kind === 'textMatch' ? rule.patterns.join(', ') : '');
  const [minS, setMinS] = useState(rule?.kind === 'randomInterval' ? rule.minMs / 1000 : 2.4);
  const [maxS, setMaxS] = useState(rule?.kind === 'randomInterval' ? rule.maxMs / 1000 : 5.2);
  const [intervalS, setIntervalS] = useState(rule?.kind === 'timer' ? rule.intervalMs / 1000 : 30);
  const [n, setN] = useState(rule?.kind === 'everyNMessages' ? rule.n : 3);
  const [keys, setKeys] = useState(rule?.kind === 'shortcut' ? rule.keys : 'alt+shift+w');
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => new Set(takenIds.filter((id) => id !== rule?.id)), [takenIds, rule]);

  const save = () => {
    if (!animationId) {
      setError('Pick a clip to play.');
      return;
    }
    const base = { id: rule?.id ?? ruleId(taken), animationId, enabled: rule?.enabled ?? true };
    let out: TriggerRule;
    switch (kind) {
      case 'manual':
      case 'api':
        out = { ...base, kind };
        break;
      case 'shortcut':
        if (!keys.trim()) {
          setError('Enter a key chord, e.g. alt+shift+w.');
          return;
        }
        out = { ...base, kind, keys: keys.trim().toLowerCase() };
        break;
      case 'conversationEvent':
        out = { ...base, kind, event };
        break;
      case 'textMatch': {
        const list = patterns
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        if (list.length === 0) {
          setError('Add at least one pattern (comma-separated).');
          return;
        }
        if (mode === 'regex') {
          for (const p of list) {
            try {
              new RegExp(p);
            } catch {
              setError(`Invalid regex: ${p}`);
              return;
            }
          }
        }
        out = { ...base, kind, mode, patterns: list, target };
        break;
      }
      case 'everyNMessages':
        if (n < 1 || n > 100) {
          setError('N must be 1–100.');
          return;
        }
        out = { ...base, kind, n: Math.round(n) };
        break;
      case 'timer':
        if (intervalS < 1) {
          setError('Interval must be at least 1 second.');
          return;
        }
        out = { ...base, kind, intervalMs: Math.round(intervalS * 1000) };
        break;
      case 'randomInterval': {
        const minMs = Math.round(minS * 1000);
        const maxMs = Math.round(maxS * 1000);
        if (!(minMs >= 500 && minMs <= maxMs)) {
          setError('Needs 0.5s ≤ min ≤ max.');
          return;
        }
        out = { ...base, kind, minMs, maxMs };
        break;
      }
    }
    onSave(out);
  };

  const kindMeta = KINDS.find((k) => k.id === kind);

  return (
    <Overlay open={open} onClose={onClose} width={560} align="top">
      <div className="flex flex-col gap-4 p-5">
        <header>
          <h2 className="text-h3 font-semibold text-ink">{rule ? 'Edit trigger' : 'New trigger'}</h2>
          <p className="mt-0.5 text-small text-muted">{kindMeta?.hint}</p>
        </header>

        <Field label="Play clip">
          <select value={animationId} onChange={(e) => setAnimationId(e.target.value)} aria-label="Clip" className={selectCls}>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="When">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TriggerRule['kind'])}
            aria-label="Trigger kind"
            className={selectCls}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        {kind === 'conversationEvent' && (
          <Field label="Moment">
            <select value={event} onChange={(e) => setEvent(e.target.value as ConversationEvent)} aria-label="Conversation event" className={selectCls}>
              {EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </Field>
        )}

        {kind === 'textMatch' && (
          <>
            <Field label="In">
              <select value={target} onChange={(e) => setTarget(e.target.value as 'assistant' | 'user')} aria-label="Match target" className={selectCls}>
                <option value="user">what I say</option>
                <option value="assistant">what the mentor says</option>
              </select>
            </Field>
            <Field label="Match">
              <select value={mode} onChange={(e) => setMode(e.target.value as TextMatchMode)} aria-label="Match mode" className={selectCls}>
                {MATCH_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Patterns">
              <input
                value={patterns}
                onChange={(e) => setPatterns(e.target.value)}
                placeholder="hello, hey there  (comma-separated)"
                className={cn(inputCls, 'flex-1')}
              />
            </Field>
          </>
        )}

        {kind === 'randomInterval' && (
          <Field label="Between">
            <div className="flex items-center gap-2 text-small text-muted">
              <input type="number" min={0.5} step={0.1} value={minS} onChange={(e) => setMinS(Number(e.target.value))} aria-label="Minimum seconds" className={cn(inputCls, 'w-20')} />
              and
              <input type="number" min={0.5} step={0.1} value={maxS} onChange={(e) => setMaxS(Number(e.target.value))} aria-label="Maximum seconds" className={cn(inputCls, 'w-20')} />
              seconds
            </div>
          </Field>
        )}

        {kind === 'timer' && (
          <Field label="Every">
            <div className="flex items-center gap-2 text-small text-muted">
              <input type="number" min={1} value={intervalS} onChange={(e) => setIntervalS(Number(e.target.value))} aria-label="Interval seconds" className={cn(inputCls, 'w-20')} />
              seconds
            </div>
          </Field>
        )}

        {kind === 'everyNMessages' && (
          <Field label="Every">
            <div className="flex items-center gap-2 text-small text-muted">
              <input type="number" min={1} max={100} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Message count" className={cn(inputCls, 'w-20')} />
              messages I send
            </div>
          </Field>
        )}

        {kind === 'shortcut' && (
          <Field label="Keys">
            <input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="alt+shift+w" className={cn(inputCls, 'w-48 font-mono')} />
          </Field>
        )}

        {error && <p className="text-small text-[var(--danger)]">{error}</p>}
        <footer className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {rule ? 'Apply' : 'Add trigger'}
          </Button>
        </footer>
      </div>
    </Overlay>
  );
}
