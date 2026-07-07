import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, X } from 'lucide-react';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { usePersonas } from '../../../lib/personaStore';
import { useSettings } from '../../../lib/settingsStore';
import type { FacePresetId, PersonaInput, PersonaRecord, PersonaStyle } from '../../../lib/coreClient';
import { Overlay, Button } from '../../../ui';

/** Local id-only list — avoids pulling the (image-heavy) face preset modules in for a plain <select>. */
const FACE_PRESET_OPTIONS: { id: FacePresetId; label: string }[] = [
  { id: 'aura', label: 'Aura — minimal, in-orb' },
  { id: 'nova', label: 'Nova' },
  { id: 'ivy', label: 'Ivy' },
  { id: 'rae', label: 'Rae' },
  { id: 'lena', label: 'Lena' },
  { id: 'sienna', label: 'Sienna' },
  { id: 'kira', label: 'Kira' },
];

const STYLE_OPTIONS: { id: PersonaStyle; label: string }[] = [
  { id: 'strict', label: 'Strict' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'supportive', label: 'Supportive' },
];

const BLURB_MIN = 20;
const BLURB_MAX = 1200;
const MAX_DOMAINS = 8;

const FIELD =
  'h-9 w-full rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris)]';
const TEXTAREA = cn(FIELD, 'h-auto min-h-24 w-full resize-y rounded-[10px] py-2 leading-relaxed');

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

function StyleSegmented({ value, onChange }: { value: PersonaStyle; onChange: (v: PersonaStyle) => void }) {
  return (
    <div role="radiogroup" aria-label="Coaching style" className="relative inline-flex w-full rounded-full bg-surface-2 p-1 hairline">
      {STYLE_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'relative z-10 flex h-7 flex-1 items-center justify-center rounded-full px-2 text-small font-medium',
              active ? 'text-ink' : 'text-muted hover:text-body',
            )}
          >
            {opt.label}
            {active && (
              <motion.span
                layoutId="persona-style-indicator"
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

function DomainsInput({ domains, onChange }: { domains: string[]; onChange: (d: string[]) => void }) {
  const [text, setText] = useState('');
  const atLimit = domains.length >= MAX_DOMAINS;

  function commit() {
    const v = text.trim();
    setText('');
    if (!v || atLimit || domains.includes(v)) return;
    onChange([...domains, v]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {domains.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 hairline px-2.5 py-1 text-[12px] text-body"
            >
              {d}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                onClick={() => onChange(domains.filter((x) => x !== d))}
                className="rounded-full text-faint hover:text-danger"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && text === '' && domains.length > 0) {
            onChange(domains.slice(0, -1));
          }
        }}
        placeholder={atLimit ? 'Max 8 domains' : 'distributed systems, then ⏎'}
        disabled={atLimit}
        className={FIELD}
      />
    </div>
  );
}

export interface PersonaEditorTarget {
  mode: 'create' | 'edit';
  record?: PersonaRecord;
}

/**
 * Create/edit overlay for a custom persona, including "Draft it for me"
 * (a description → model-drafted starting point the user then edits).
 * Keyboard-first: Esc closes, confirming discard only if the form is dirty.
 */
export function PersonaEditorOverlay({
  target,
  onClose,
}: {
  target: PersonaEditorTarget | null;
  onClose: () => void;
}) {
  const create = usePersonas((s) => s.create);
  const update = usePersonas((s) => s.update);
  const draftPersona = usePersonas((s) => s.draft);
  const saving = usePersonas((s) => s.saving);
  const saveError = usePersonas((s) => s.saveError);
  const clearSaveError = usePersonas((s) => s.clearSaveError);
  const drafting = usePersonas((s) => s.drafting);
  const draftError = usePersonas((s) => s.draftError);
  const clearDraftError = usePersonas((s) => s.clearDraftError);
  const voices = useSettings((s) => s.voices);

  const open = target !== null;
  const editing = target?.mode === 'edit' ? (target.record ?? null) : null;

  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [style, setStyle] = useState<PersonaStyle>('balanced');
  const [domains, setDomains] = useState<string[]>([]);
  const [blurb, setBlurb] = useState('');
  const [mentorFace, setMentorFace] = useState<FacePresetId | ''>('');
  const [ttsVoice, setTtsVoice] = useState<string>('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset (or prefill for edit) every time the overlay opens.
  useEffect(() => {
    if (!open) return;
    clearSaveError();
    clearDraftError();
    setConfirmDiscard(false);
    setDirty(false);
    setDescription('');
    if (editing) {
      setName(editing.name);
      setTagline(editing.tagline);
      setStyle(editing.style);
      setDomains(editing.domains);
      setBlurb(editing.blurb);
      setMentorFace(editing.mentorFace ?? '');
      setTtsVoice(editing.ttsVoice ?? '');
    } else {
      setName('');
      setTagline('');
      setStyle('balanced');
      setDomains([]);
      setBlurb('');
      setMentorFace('');
      setTtsVoice('');
    }
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function handleDraft() {
    const text = description.trim();
    if (!text || drafting) return;
    const result = await draftPersona({ description: text, name: name.trim() || undefined, style });
    if (!result) return; // draftError already set
    setName(result.name);
    setTagline(result.tagline);
    setStyle(result.style);
    setDomains(result.domains);
    setBlurb(result.blurb);
    if (result.mentorFace) setMentorFace(result.mentorFace);
    if (result.ttsVoice) setTtsVoice(result.ttsVoice);
    setDirty(true);
  }

  const blurbLen = blurb.trim().length;
  const blurbValid = blurbLen >= BLURB_MIN && blurbLen <= BLURB_MAX;
  const saveDisabled = saving || name.trim() === '' || tagline.trim() === '' || !blurbValid;

  async function handleSave() {
    const input: PersonaInput = {
      name: name.trim(),
      tagline: tagline.trim(),
      style,
      domains,
      blurb: blurb.trim(),
      mentorFace: mentorFace || undefined,
      ttsVoice: ttsVoice || undefined,
    };
    const result = editing ? await update(editing.id, input) : await create(input);
    if (result) onClose();
  }

  function requestClose() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <Overlay open={open} onClose={requestClose} width={680} align="center" className="flex max-h-[85vh] w-full flex-col">
      {confirmDiscard && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
          <p className="text-small text-ink">Discard this persona? Your edits will be lost.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button size="sm" variant="danger" onClick={onClose}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="border-b border-line px-5 py-4">
        <h2 className="text-h3 text-ink">{editing ? `Edit ${editing.name}` : 'New persona'}</h2>
        <p className="mt-0.5 text-small text-muted">
          The blurb sets tone only — every persona still teaches hints-before-answers.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {!editing && (
          <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2/60 p-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} strokeWidth={1.5} className="text-faint" />
              <span className="text-small font-medium text-ink">Draft it for me</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A no-nonsense FAANG bar-raiser who drills me on distributed-systems tradeoffs and won't let sloppy complexity analysis slide."
              rows={2}
              className={TEXTAREA}
            />
            {draftError && !drafting && (
              <div className="flex items-center justify-between gap-3 rounded-[8px] bg-danger/10 px-3 py-2">
                <p className="text-[12px] text-danger">{draftError}</p>
                <Button size="sm" variant="ghost" onClick={() => void handleDraft()}>
                  Retry
                </Button>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                icon={<Sparkles size={13} strokeWidth={1.5} />}
                loading={drafting}
                loadingLabel="Drafting…"
                disabled={description.trim() === '' || drafting}
                onClick={() => void handleDraft()}
              >
                Draft it for me
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => edit(setName)(e.target.value)}
              placeholder="Priya — FAANG Staff"
              className={FIELD}
            />
          </Field>
          <Field label="Style">
            <StyleSegmented value={style} onChange={edit(setStyle)} />
          </Field>
        </div>

        <Field label="Tagline">
          <input
            value={tagline}
            onChange={(e) => edit(setTagline)(e.target.value)}
            placeholder="Blunt, systems-first, no hand-holding"
            className={FIELD}
          />
        </Field>

        <Field label="Domains" hint="(⏎ to add, up to 8)">
          <DomainsInput domains={domains} onChange={edit(setDomains)} />
        </Field>

        <Field
          label="Blurb"
          hint={`(${blurbLen}/${BLURB_MAX}${blurbLen > 0 && blurbLen < BLURB_MIN ? ` — needs ${BLURB_MIN - blurbLen} more` : ''})`}
        >
          <textarea
            value={blurb}
            onChange={(e) => edit(setBlurb)(e.target.value.slice(0, BLURB_MAX))}
            placeholder="Speak to Abhay directly, second person. Set the tone this mentor answers in — pragmatic, probing, patient, whatever fits."
            rows={5}
            className={cn(TEXTAREA, blurbLen > 0 && !blurbValid && 'outline outline-2 outline-offset-0 outline-danger/60')}
          />
        </Field>

        <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2/60 p-3">
          <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
            Appearance &amp; voice <span className="normal-case text-faint">— applied when this persona activates</span>
          </span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">Face</span>
              <select
                value={mentorFace}
                onChange={(e) => edit(setMentorFace)(e.target.value as FacePresetId | '')}
                className={FIELD}
              >
                <option value="">No change</option>
                {FACE_PRESET_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">Voice</span>
              <select value={ttsVoice} onChange={(e) => edit(setTtsVoice)(e.target.value)} className={FIELD}>
                <option value="">No change</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.accent === 'american' ? 'US' : 'UK'} {v.gender})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        {saveError ? <p className="max-w-sm text-[12px] text-danger">{saveError}</p> : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" disabled={saveDisabled} onClick={() => void handleSave()}>
            {editing ? 'Save changes' : 'Create persona'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
