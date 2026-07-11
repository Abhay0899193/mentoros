import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Camera,
  Film,
  Lock,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { Button, Chip, Switch, toast } from '../../../ui';
import { cn } from '../../../lib/cn';
import { spring } from '../../../motion/springs';
import { useFaces } from '../../../lib/faceStore';
import { useSettings } from '../../../lib/settingsStore';
import type {
  AnimationClip,
  AvatarConfig,
  FacePresetId,
  TriggerRule,
} from '../../../lib/coreClient';
import { FACE_PRESETS, type FacePreset } from '../../../orb/faces/presets';
import { REALISTIC_PRESETS, type RealisticPreset } from '../../../orb/faces/realistic';
import { realisticBuiltinConfig, stylizedConfig } from '../../../orb/animation/configs';
import type { AnimationController } from '../../../orb/animation/controller';
import { FacePortrait } from '../../../orb/faces/FacePortrait';
import { StudioPreview } from './StudioPreview';
import { ClipEditor } from './ClipEditor';
import { TriggerEditor } from './TriggerEditor';
import { CreateFromFramesWizard } from './CreateFromFramesWizard';
import { GeneratePresetWizard } from './GeneratePresetWizard';
import { CreateFacePresetOverlay } from '../settings/CreateFacePresetOverlay';
import { ImageLab } from './ImageLab';

/**
 * Avatar Studio — the first-class home for creating and animating mentor
 * avatars (moved out of Settings by design). Left: every preset (yours are
 * editable, built-ins are view-only — their art ships in the app bundle).
 * Right: live preview sandbox + the clip library + trigger rules. Edits are
 * drafted locally and saved as one document (PUT config), so Save/Discard is
 * always an honest whole-preset operation.
 */

interface Entry {
  id: FacePresetId;
  name: string;
  custom: boolean;
  kind: 'sprite' | 'stylized';
  thumb?: string; // sprite families
  stylized?: FacePreset;
  realistic?: RealisticPreset;
}

interface Draft {
  name: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  defaultAnimationId?: string;
}

type StudioView = 'avatars' | 'imagelab';

const STUDIO_VIEWS: { id: StudioView; label: string }[] = [
  { id: 'avatars', label: 'Avatars' },
  { id: 'imagelab', label: 'Image Lab' },
];

/** Monochrome, spring-animated view switch (same pill idiom as the settings SegmentedRow). */
function StudioViewSwitch({ view, onChange }: { view: StudioView; onChange: (v: StudioView) => void }) {
  return (
    <div role="tablist" aria-label="Studio view" className="relative inline-flex w-fit shrink-0 rounded-full bg-surface-2 p-1 hairline">
      {STUDIO_VIEWS.map((opt) => {
        const active = view === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'relative z-10 flex h-7 items-center justify-center rounded-full px-3.5 text-small font-medium',
              active ? 'text-ink' : 'text-muted hover:text-body',
            )}
          >
            {opt.label}
            {active && (
              <motion.span
                layoutId="studio-view-pill"
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

/** Strip the served URL back to the bare art filename core stores. */
function relativizeFrame(src: string): string {
  if (src.startsWith('data:')) return src;
  const m = src.match(/\/faces\/art\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : src.split('/').pop() ?? src;
}

function describeTrigger(rule: TriggerRule): string {
  switch (rule.kind) {
    case 'manual':
      return 'When played by hand';
    case 'api':
      return 'When the app calls it';
    case 'shortcut':
      return `On ${rule.keys}`;
    case 'conversationEvent':
      return `On ${rule.event.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
    case 'textMatch':
      return `When ${rule.target === 'user' ? 'you' : 'the mentor'} say${rule.target === 'user' ? '' : 's'} ${rule.patterns.map((p) => `“${p}”`).join(', ')}`;
    case 'everyNMessages':
      return `Every ${rule.n} message${rule.n === 1 ? '' : 's'} you send`;
    case 'timer':
      return `Every ${Math.round(rule.intervalMs / 100) / 10}s`;
    case 'randomInterval':
      return `Randomly every ${Math.round(rule.minMs / 100) / 10}–${Math.round(rule.maxMs / 100) / 10}s`;
  }
}

export function AvatarStudioScreen() {
  const initFaces = useFaces((s) => s.init);
  const customPresets = useFaces((s) => s.customPresets);
  const job = useFaces((s) => s.job);
  const cancelJob = useFaces((s) => s.cancelJob);
  const dismissJob = useFaces((s) => s.dismissJob);
  const removePreset = useFaces((s) => s.remove);
  const saveConfig = useFaces((s) => s.saveConfig);
  const refreshToolchain = useFaces((s) => s.refreshToolchain);
  const initSettings = useSettings((s) => s.init);
  const settings = useSettings((s) => s.settings);
  const setMentorLook = useSettings((s) => s.setMentorLook);

  useEffect(() => {
    initFaces();
    initSettings();
    void refreshToolchain();
  }, [initFaces, initSettings, refreshToolchain]);

  const entries = useMemo<Entry[]>(
    () => [
      ...customPresets.map((p) => ({
        id: p.id,
        name: p.name,
        custom: true,
        kind: 'sprite' as const,
        thumb: p.portrait.base,
        realistic: p,
      })),
      ...REALISTIC_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        custom: false,
        kind: 'sprite' as const,
        thumb: p.portrait.base,
        realistic: p,
      })),
      ...FACE_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        custom: false,
        kind: 'stylized' as const,
        stylized: p,
      })),
    ],
    [customPresets],
  );

  const [view, setView] = useState<StudioView>('avatars');
  const [selectedId, setSelectedId] = useState<FacePresetId | null>(null);
  const selected =
    entries.find((e) => e.id === selectedId) ??
    entries.find((e) => e.id === settings?.mentorFace) ??
    entries[0];

  /* ------------------------------- draft state ----------------------------- */
  const baseConfig = useMemo<AvatarConfig | null>(() => {
    if (!selected) return null;
    if (selected.kind === 'stylized') return stylizedConfig(selected.stylized!);
    const preset = selected.realistic!;
    return preset.config ?? realisticBuiltinConfig(preset);
  }, [selected]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // (Re)seed the draft whenever the selected preset or its saved doc changes.
    setDraft(
      baseConfig
        ? {
            name: baseConfig.name,
            animations: baseConfig.animations,
            triggers: baseConfig.triggers,
            defaultAnimationId: baseConfig.defaultAnimationId,
          }
        : null,
    );
  }, [baseConfig]);

  const dirty =
    !!draft &&
    !!baseConfig &&
    JSON.stringify(draft) !==
      JSON.stringify({
        name: baseConfig.name,
        animations: baseConfig.animations,
        triggers: baseConfig.triggers,
        defaultAnimationId: baseConfig.defaultAnimationId,
      });

  /** Display config = saved doc + draft edits (frames may be data URIs). */
  const displayConfig = useMemo<AvatarConfig | null>(() => {
    if (!baseConfig || selected?.kind !== 'sprite') return null;
    if (!draft) return baseConfig;
    return { ...baseConfig, name: draft.name, animations: draft.animations, triggers: draft.triggers, defaultAnimationId: draft.defaultAnimationId };
  }, [baseConfig, draft, selected]);

  const controllerRef = useRef<AnimationController | null>(null);

  /* -------------------------------- overlays ------------------------------- */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [clipEditor, setClipEditor] = useState<{ clip: AnimationClip | null } | null>(null);
  const [triggerEditor, setTriggerEditor] = useState<{ rule: TriggerRule | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editable = !!selected?.custom;
  const jobLive = !!job && ['queued', 'generating', 'compositing'].includes(job.state);
  const overlayOpen = wizardOpen || generateOpen || photoOpen || !!clipEditor || !!triggerEditor;

  const play = (clip: AnimationClip) => {
    controllerRef.current?.request(clip.id, { interrupt: true });
  };

  const saveClip = (clip: AnimationClip) => {
    setDraft((d) => {
      if (!d) return d;
      const exists = d.animations.some((c) => c.id === clip.id);
      return {
        ...d,
        animations: exists ? d.animations.map((c) => (c.id === clip.id ? clip : c)) : [...d.animations, clip],
      };
    });
    setClipEditor(null);
  };

  const removeClip = (id: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            animations: d.animations.filter((c) => c.id !== id),
            triggers: d.triggers.filter((t) => t.animationId !== id),
            defaultAnimationId: d.defaultAnimationId === id ? undefined : d.defaultAnimationId,
          }
        : d,
    );
  };

  const saveTrigger = (rule: TriggerRule) => {
    setDraft((d) => {
      if (!d) return d;
      const exists = d.triggers.some((t) => t.id === rule.id);
      return { ...d, triggers: exists ? d.triggers.map((t) => (t.id === rule.id ? rule : t)) : [...d.triggers, rule] };
    });
    setTriggerEditor(null);
  };

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    const ok = await saveConfig(selected.id, {
      name: draft.name,
      animations: draft.animations.map((c) => ({
        ...c,
        frames: c.frames?.map(relativizeFrame),
        thumbnail: undefined,
      })),
      triggers: draft.triggers,
      defaultAnimationId: draft.defaultAnimationId,
    });
    setSaving(false);
    if (ok) toast({ tone: 'success', title: 'Preset saved', description: 'Changes are live everywhere she appears.' });
  };

  const activeOnVoice = settings?.mentorFace === selected?.id && settings?.mentorIdentity === 'face';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
        <StudioViewSwitch view={view} onChange={setView} />
      </div>

      {view === 'imagelab' ? (
        <ImageLab />
      ) : (
      <div className="flex min-h-0 flex-1">
      {/* ----------------------------- preset list ---------------------------- */}
      <aside className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface-1 p-3">
        <div className="mb-1 flex flex-col gap-1.5">
          <Button size="sm" variant="primary" icon={<Sparkles size={14} strokeWidth={1.5} />} onClick={() => setGenerateOpen(true)}>
            Generate a preset
          </Button>
          <Button size="sm" icon={<Film size={14} strokeWidth={1.5} />} onClick={() => setWizardOpen(true)}>
            Create from frames
          </Button>
          <Button size="sm" icon={<Camera size={14} strokeWidth={1.5} />} onClick={() => setPhotoOpen(true)} disabled={jobLive}>
            Generate from photo
          </Button>
        </div>

        {job && (jobLive || job.state === 'error') && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-surface-2 p-2.5 hairline">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-small font-medium text-ink">{job.name}</span>
              <button onClick={() => (jobLive ? void cancelJob() : dismissJob())} className="shrink-0 text-[11px] text-muted hover:text-body">
                {jobLive ? 'Cancel' : 'Dismiss'}
              </button>
            </div>
            {jobLive ? (
              <>
                <span className="text-[11px] text-muted">{job.step}</span>
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--aurora)' }}
                    animate={{ width: `${Math.max(4, (job.completedFrames / Math.max(1, job.totalFrames)) * 100)}%` }}
                    transition={spring.smooth}
                  />
                </div>
              </>
            ) : (
              <span className="text-[11px] text-[var(--danger)]">{job.error ?? 'Generation failed.'}</span>
            )}
          </div>
        )}

        {(
          [
            ['Your presets', entries.filter((e) => e.custom)],
            ['Built-in · Realistic', entries.filter((e) => !e.custom && e.kind === 'sprite')],
            ['Built-in · Stylized', entries.filter((e) => e.kind === 'stylized')],
          ] as [string, Entry[]][]
        ).map(([label, group]) =>
          group.length === 0 && label === 'Your presets' ? (
            <p key={label} className="mt-2 px-1 text-[11px] leading-snug text-faint">
              No presets of your own yet — create one from frames or a photo.
            </p>
          ) : group.length === 0 ? null : (
            <div key={label} className="mt-2 flex flex-col gap-0.5">
              <span className="px-1 text-label font-medium uppercase tracking-wide text-faint">{label}</span>
              {group.map((e) => {
                const active = selected?.id === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      setSelectedId(e.id);
                      setConfirmDelete(false);
                    }}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex h-11 items-center gap-2.5 rounded-[10px] px-2 text-left',
                      active ? 'bg-surface-2 text-ink hairline' : 'text-body hover:bg-surface-2',
                    )}
                  >
                    {e.thumb ? (
                      <img src={e.thumb} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3">
                        {e.stylized && <FacePortrait preset={e.stylized} glam="polished" maturity="balanced" state="idle" size={30} frozen reactive={false} />}
                      </span>
                    )}
                    <span className="flex-1 truncate text-small font-medium">{e.name}</span>
                    {!e.custom && <Lock size={11} strokeWidth={1.5} className="shrink-0 text-faint" aria-label="Built-in — view only" />}
                  </button>
                );
              })}
            </div>
          ),
        )}
      </aside>

      {/* ------------------------------- detail ------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            {editable && draft ? (
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                maxLength={60}
                aria-label="Preset name"
                className="w-64 rounded-[8px] bg-transparent text-h2 font-semibold text-ink outline-none hover:bg-surface-1 focus:bg-surface-1 focus:px-2"
              />
            ) : (
              <h1 className="truncate text-h2 font-semibold text-ink">{selected?.name ?? 'Avatar Studio'}</h1>
            )}
            <p className="mt-0.5 text-small text-muted">
              {editable
                ? 'Your preset — add clips, wire triggers, and she updates everywhere.'
                : selected?.kind === 'stylized'
                  ? 'Built-in stylized preset — its gestures are playable but the art is part of the app.'
                  : 'Built-in preset — view only. Create your own to customize.'}
            </p>
          </div>
          {activeOnVoice ? (
            <Chip>Active on Voice</Chip>
          ) : (
            selected && (
              <Button
                size="sm"
                onClick={() => void setMentorLook({ mentorIdentity: 'face', mentorFace: selected.id })}
              >
                Use on Voice screen
              </Button>
            )
          )}
          {editable && !confirmDelete && (
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} strokeWidth={1.5} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
          {editable && confirmDelete && (
            <span className="flex items-center gap-1.5 text-small">
              <span className="text-body">Delete preset?</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmDelete(false);
                  if (selected) void removePreset(selected.id);
                  setSelectedId(null);
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </span>
          )}
        </header>

        {selected && (
          <div className="flex flex-wrap items-start gap-8 px-6 py-5">
            <StudioPreview
              config={displayConfig}
              stylized={selected.kind === 'stylized' ? selected.stylized! : null}
              controllerRef={controllerRef}
              frozen={overlayOpen}
            />

            <div className="flex min-w-[340px] flex-1 flex-col gap-5">
              {/* ------------------------------ clips ----------------------------- */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-label font-medium uppercase tracking-wide text-muted">
                    Clips ({draft?.animations.length ?? 0})
                  </h2>
                  {editable && (
                    <Button size="sm" variant="ghost" icon={<Plus size={13} strokeWidth={1.5} />} onClick={() => setClipEditor({ clip: null })}>
                      Add clip
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {(draft?.animations ?? []).map((clip) => (
                    <div key={clip.id} className="flex items-center gap-3 rounded-[10px] bg-surface-1 px-3 py-2 hairline">
                      {clip.renderKind === 'sprite' && clip.frames?.[0] ? (
                        <img src={clip.frames[0]} alt="" className="h-9 w-9 shrink-0 rounded-[6px] object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-surface-2 text-faint">
                          <Zap size={14} strokeWidth={1.5} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-small font-medium text-ink">{clip.name}</span>
                          <Chip className="capitalize">{clip.category}</Chip>
                        </div>
                        <span className="text-[11px] text-faint">
                          {clip.renderKind === 'sprite' ? `${clip.frames?.length ?? 0} frame${(clip.frames?.length ?? 0) === 1 ? '' : 's'}` : 'pose'} · {clip.track} track ·{' '}
                          {clip.driver === 'envelope' ? 'follows her voice' : `${clip.loopMode}`}
                        </span>
                      </div>
                      {clip.driver === 'envelope' ? (
                        <span className="shrink-0 text-[11px] text-faint">hit Speak to audition</span>
                      ) : (
                        <button
                          aria-label={`Play ${clip.name}`}
                          onClick={() => play(clip)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted hairline hover:bg-surface-3 hover:text-ink"
                        >
                          <Play size={12} strokeWidth={2} />
                        </button>
                      )}
                      {editable && (
                        <>
                          <button
                            aria-label={`Edit ${clip.name}`}
                            onClick={() => setClipEditor({ clip })}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                          >
                            <Pencil size={12} strokeWidth={1.5} />
                          </button>
                          <button
                            aria-label={`Delete ${clip.name}`}
                            onClick={() => removeClip(clip.id)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-[var(--danger)]"
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {(draft?.animations.length ?? 0) === 0 && (
                    <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
                      No clips yet — add one to bring her to life.
                    </p>
                  )}
                </div>
              </section>

              {/* ---------------------------- triggers ---------------------------- */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-label font-medium uppercase tracking-wide text-muted">
                    Triggers ({draft?.triggers.length ?? 0})
                  </h2>
                  {editable && (draft?.animations.length ?? 0) > 0 && (
                    <Button size="sm" variant="ghost" icon={<Plus size={13} strokeWidth={1.5} />} onClick={() => setTriggerEditor({ rule: null })}>
                      Add trigger
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {(draft?.triggers ?? []).map((rule) => {
                    const clip = draft?.animations.find((c) => c.id === rule.animationId);
                    return (
                      <div key={rule.id} className="flex items-center gap-3 rounded-[10px] bg-surface-1 px-3 py-2 hairline">
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-small text-ink">
                            {describeTrigger(rule)} → <span className="font-medium">{clip?.name ?? rule.animationId}</span>
                          </span>
                          <span className="text-[11px] capitalize text-faint">{rule.kind.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                        </div>
                        {editable ? (
                          <>
                            <Switch
                              checked={rule.enabled}
                              onChange={(v) =>
                                setDraft((d) =>
                                  d ? { ...d, triggers: d.triggers.map((t) => (t.id === rule.id ? { ...t, enabled: v } : t)) } : d,
                                )
                              }
                              label={`${rule.enabled ? 'Disable' : 'Enable'} trigger`}
                            />
                            <button
                              aria-label="Edit trigger"
                              onClick={() => setTriggerEditor({ rule })}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                            >
                              <Pencil size={12} strokeWidth={1.5} />
                            </button>
                            <button
                              aria-label="Delete trigger"
                              onClick={() => setDraft((d) => (d ? { ...d, triggers: d.triggers.filter((t) => t.id !== rule.id) } : d))}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-[var(--danger)]"
                            >
                              <Trash2 size={12} strokeWidth={1.5} />
                            </button>
                          </>
                        ) : (
                          <Chip>{rule.enabled ? 'on' : 'off'}</Chip>
                        )}
                      </div>
                    );
                  })}
                  {(draft?.triggers.length ?? 0) === 0 && (
                    <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
                      {selected.kind === 'stylized'
                        ? 'Stylized gestures play manually (or via the API) — no rules yet.'
                        : 'No triggers — clips only play when you press Play.'}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
      </div>
      )}
      {/* --------------------------- save bar (dirty) --------------------------- */}
      {view === 'avatars' && editable && dirty && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.smooth}
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-surface-2 py-2 pl-4 pr-2 shadow-lg hairline-strong"
        >
          <span className="text-small text-body">Unsaved changes</span>
          <Button size="sm" variant="ghost" onClick={() => setDraft(baseConfig ? { name: baseConfig.name, animations: baseConfig.animations, triggers: baseConfig.triggers, defaultAnimationId: baseConfig.defaultAnimationId } : null)}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} loadingLabel="Saving…">
            Save changes
          </Button>
        </motion.div>
      )}

      {/* -------------------------------- overlays ------------------------------ */}
      <CreateFromFramesWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id) => setSelectedId(id)}
      />
      <GeneratePresetWizard
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCreated={(id) => setSelectedId(id)}
      />
      <CreateFacePresetOverlay open={photoOpen} onClose={() => setPhotoOpen(false)} />
      {clipEditor && (
        <ClipEditor
          open
          clip={clipEditor.clip}
          takenIds={(draft?.animations ?? []).map((c) => c.id)}
          baseFrame={baseConfig?.baseFrame ?? null}
          fullBase={baseConfig?.fullBase ?? null}
          onSave={saveClip}
          onClose={() => setClipEditor(null)}
        />
      )}
      {triggerEditor && draft && (
        <TriggerEditor
          open
          rule={triggerEditor.rule}
          clips={draft.animations}
          takenIds={draft.triggers.map((t) => t.id)}
          onSave={saveTrigger}
          onClose={() => setTriggerEditor(null)}
        />
      )}
    </div>
  );
}
