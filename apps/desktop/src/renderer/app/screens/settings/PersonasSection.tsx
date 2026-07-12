import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePersonas } from '../../../lib/personaStore';
import { useSettings } from '../../../lib/settingsStore';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { Persona, PersonaRecord, PersonaStyle } from '../../../lib/coreClient';
import { resolvePersonaMeta } from '../chat/personas';
import { Panel, Chip, Button } from '../../../ui';
import { PersonaEditorOverlay, type PersonaEditorTarget } from './PersonaEditorOverlay';

const STYLE_LABEL: Record<PersonaStyle, string> = {
  strict: 'Strict',
  balanced: 'Balanced',
  supportive: 'Supportive',
};

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
      <div className="h-3 w-32 animate-pulse rounded-full bg-surface-2" />
      <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
      <div className="ml-auto h-8 w-16 animate-pulse rounded-[10px] bg-surface-2" />
    </div>
  );
}

function PersonaRow({
  record,
  active,
  onUse,
  onEdit,
  onDelete,
}: {
  record: PersonaRecord;
  active: boolean;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const meta = resolvePersonaMeta(record.id, [record]);

  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate text-small text-ink">
          Delete persona? <span className="text-muted">“{record.name}”</span>
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-150',
        active ? 'bg-surface-2 ring-1 ring-iris/40' : 'hover:bg-surface-2/60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-small font-medium text-ink">{record.name}</span>
          <Chip tone={meta.tone}>{STYLE_LABEL[record.style]}</Chip>
          {active && <Chip tone="iris">Active</Chip>}
          {!record.builtIn && <Chip>Custom</Chip>}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted">{record.tagline}</p>
        {record.domains.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {record.domains.map((d) => (
              <Chip key={d} tone="neutral">
                {d}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!record.builtIn && (
          <>
            <button
              aria-label={`Edit ${record.name}`}
              onClick={onEdit}
              className="tap-target rounded-[6px] p-1.5 text-faint opacity-0 coarse:opacity-100 hover:bg-surface-3 hover:text-body focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Pencil size={13} strokeWidth={1.5} />
            </button>
            <button
              aria-label={`Delete ${record.name}`}
              onClick={() => setConfirming(true)}
              className="tap-target rounded-[6px] p-1.5 text-faint opacity-0 coarse:opacity-100 hover:bg-surface-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>
          </>
        )}
        {!active && (
          <Button size="sm" variant="secondary" onClick={onUse}>
            Use
          </Button>
        )}
      </div>
    </div>
  );
}

/** Built-in + custom mentor personas (§Settings → Personas). */
export function PersonasSection() {
  const init = usePersonas((s) => s.init);
  const personas = usePersonas((s) => s.personas);
  const personasLoading = usePersonas((s) => s.personasLoading);
  const personasError = usePersonas((s) => s.personasError);
  const loadPersonas = usePersonas((s) => s.loadPersonas);
  const remove = usePersonas((s) => s.remove);

  const settings = useSettings((s) => s.settings);
  const setActivePersona = useSettings((s) => s.setActivePersona);

  const [editorTarget, setEditorTarget] = useState<PersonaEditorTarget | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => init(), [init]);

  const activeId: Persona = settings?.activePersona ?? 'staff-engineer';
  const builtins = personas.filter((p) => p.builtIn);
  const customs = personas.filter((p) => !p.builtIn);

  return (
    <>
      <Panel
        title="Personas"
        accessory={
          <Button size="sm" icon={<Plus size={13} strokeWidth={1.5} />} onClick={() => setEditorTarget({ mode: 'create' })}>
            New persona
          </Button>
        }
      >
        {personasLoading && personas.length === 0 ? (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : personasError && personas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle size={22} strokeWidth={1.5} className="text-faint" />
            <p className="text-small text-muted">{personasError}</p>
            <Button size="sm" onClick={() => void loadPersonas()}>
              Retry
            </Button>
          </div>
        ) : (
          <motion.div
            variants={reduced(reduce, staggerChildren)}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-4"
          >
            <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-0.5">
              {builtins.map((p) => (
                <PersonaRow
                  key={p.id}
                  record={p}
                  active={p.id === activeId}
                  onUse={() => void setActivePersona(p.id)}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              ))}
            </motion.div>

            <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-0.5 border-t border-line pt-3">
              <h4 className="px-3 pb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">Custom</h4>
              {customs.length === 0 ? (
                <p className="px-3 py-2 text-small text-muted">
                  No custom personas yet — try “New persona” to build a mentor voice of your own.
                </p>
              ) : (
                customs.map((p) => (
                  <PersonaRow
                    key={p.id}
                    record={p}
                    active={p.id === activeId}
                    onUse={() => void setActivePersona(p.id)}
                    onEdit={() => setEditorTarget({ mode: 'edit', record: p })}
                    onDelete={() => void remove(p.id)}
                  />
                ))
              )}
            </motion.div>
          </motion.div>
        )}
      </Panel>

      <PersonaEditorOverlay target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  );
}
