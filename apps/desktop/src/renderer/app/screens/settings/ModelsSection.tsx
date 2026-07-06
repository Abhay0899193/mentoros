import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Cloud,
  HardDrive,
  KeyRound,
} from "lucide-react";
import { useSettings } from "../../../lib/settingsStore";
import {
  spring,
  riseIn,
  staggerChildren,
  reduced,
  dur,
} from "../../../motion/springs";
import { cn } from "../../../lib/cn";
import type {
  CloudModelInfo,
  ModelChoice,
  ModelSurface,
  ProvidersInfo,
} from "../../../lib/coreClient";
import { Panel, Chip, Switch, Button } from "../../../ui";

const SURFACES: { id: ModelSurface; label: string; description: string }[] = [
  { id: "chat", label: "Chat", description: "Conversation answers" },
  { id: "voice", label: "Voice", description: "Spoken answers" },
  {
    id: "interviewer",
    label: "Interviewer",
    description: "Live interview dialogue",
  },
  {
    id: "scorecard",
    label: "Scorecard",
    description: "Post-interview grading",
  },
];

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatCost(m: CloudModelInfo): string {
  return `$${m.inputPerMTok} / $${m.outputPerMTok} per MTok`;
}

function choiceLabel(
  choice: ModelChoice,
  providers: ProvidersInfo | null,
): string {
  if (!providers) return choice.model;
  if (choice.provider === "ollama") {
    const m = providers.ollama.models.find((x) => x.model === choice.model);
    return m ? `${m.label} · ${formatSize(m.sizeBytes)}` : choice.model;
  }
  const m = providers.anthropic.catalog.find((x) => x.model === choice.model);
  return m ? m.label : choice.model;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
      <div className="h-3 w-28 animate-pulse rounded-full bg-surface-2" />
      <div className="ml-auto h-8 w-40 animate-pulse rounded-[10px] bg-surface-2" />
    </div>
  );
}

function ApiKeyRow({ disabled }: { disabled: boolean }) {
  const anthropic = useSettings((s) => s.providers?.anthropic);
  const keySaving = useSettings((s) => s.keySaving);
  const saveAnthropicKey = useSettings((s) => s.saveAnthropicKey);
  const removeAnthropicKey = useSettings((s) => s.removeAnthropicKey);
  const [input, setInput] = useState("");

  const keyState = anthropic?.keyState ?? "none";

  async function handleSave() {
    const trimmed = input.trim();
    if (!trimmed || keySaving) return;
    const result = await saveAnthropicKey(trimmed);
    if (result !== null) setInput("");
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-[10px] bg-surface-2/60 p-3 transition-opacity duration-150",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      <div className="flex items-center gap-2">
        <KeyRound size={14} strokeWidth={1.5} className="text-faint" />
        <span className="text-small font-medium text-ink">
          Anthropic API key
        </span>
        {keyState === "valid" && <Chip tone="success">Valid</Chip>}
        {keyState === "invalid" && <Chip tone="danger">Invalid</Chip>}
      </div>

      {keyState === "valid" && anthropic?.keyMask ? (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted">
            {anthropic.keyMask}
          </span>
          <button
            onClick={() => void removeAnthropicKey()}
            disabled={disabled}
            className="text-[12px] font-medium text-faint hover:text-body"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSave()}
            placeholder="sk-ant-…"
            disabled={disabled}
            className="h-9 flex-1 rounded-[10px] bg-surface-2 hairline px-3 font-mono text-[12px] text-ink outline-none focus:[box-shadow:var(--focus)] disabled:opacity-60"
          />
          <Button
            size="sm"
            disabled={disabled || input.trim() === ""}
            loading={keySaving}
            loadingLabel="Validating…"
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </div>
      )}

      {keyState === "invalid" && anthropic?.keyError && (
        <p className="text-[12px] text-danger">{anthropic.keyError}</p>
      )}
      {keyState === "none" && (
        <p className="text-[12px] text-faint">
          Stored locally — used only to call Anthropic.
        </p>
      )}
    </div>
  );
}

function SurfacePicker({
  surface,
  choice,
  providers,
  cloudUsable,
}: {
  surface: ModelSurface;
  choice: ModelChoice;
  providers: ProvidersInfo;
  cloudUsable: boolean;
}) {
  const setSurfaceModel = useSettings((s) => s.setSurfaceModel);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Document-level, not a fixed backdrop: ancestor motion transforms turn
    // position:fixed into container-relative, so a backdrop can't cover the page.
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function choose(next: ModelChoice) {
    void setSurfaceModel(surface, next);
    setOpen(false);
  }

  const label = choiceLabel(choice, providers);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 max-w-56 items-center gap-1.5 rounded-[10px] bg-surface-2 hairline px-3 text-[12px] font-medium text-ink",
          "hover:bg-surface-3",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={1.5}
          className="shrink-0 text-faint"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={`${surface} model`}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: dur.micro } }}
            transition={spring.smooth}
            className="overlay-shadow hairline absolute top-full right-0 z-40 mt-2 w-80 rounded-[14px] bg-surface-2 p-2"
          >
            <div className="flex flex-col gap-0.5">
              <h4 className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
                <HardDrive size={11} strokeWidth={1.5} />
                Local (Ollama)
              </h4>
              {!providers.ollama.reachable ? (
                <p className="px-2 pb-2 text-[12px] text-faint">
                  Ollama not running
                </p>
              ) : providers.ollama.models.length === 0 ? (
                <p className="px-2 pb-2 text-[12px] text-faint">
                  No local models installed
                </p>
              ) : (
                providers.ollama.models.map((m) => {
                  const selected =
                    choice.provider === "ollama" && choice.model === m.model;
                  return (
                    <button
                      key={m.model}
                      role="option"
                      aria-selected={selected}
                      onClick={() =>
                        choose({ provider: "ollama", model: m.model })
                      }
                      className={cn(
                        "flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] hover:bg-surface-3",
                        selected && "bg-surface-3",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center",
                          selected ? "text-iris" : "text-transparent",
                        )}
                      >
                        <Check size={12} strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {m.label}
                      </span>
                      <span className="shrink-0 text-faint">
                        {formatSize(m.sizeBytes)}
                      </span>
                    </button>
                  );
                })
              )}

              <h4 className="mt-1 flex items-center gap-1.5 px-2 pt-1 pb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
                <Cloud size={11} strokeWidth={1.5} />
                Cloud (Claude)
              </h4>
              {!cloudUsable && (
                <p className="px-2 pb-1.5 text-[12px] text-faint">
                  Enable cloud + add a valid API key
                </p>
              )}
              <div
                className={cn(
                  "flex flex-col gap-0.5",
                  !cloudUsable && "pointer-events-none opacity-45",
                )}
              >
                {providers.anthropic.catalog.map((m) => {
                  const selected =
                    choice.provider === "anthropic" && choice.model === m.model;
                  return (
                    <button
                      key={m.model}
                      role="option"
                      aria-selected={selected}
                      onClick={() =>
                        choose({ provider: "anthropic", model: m.model })
                      }
                      className={cn(
                        "flex flex-col gap-0.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] hover:bg-surface-3",
                        selected && "bg-surface-3",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center",
                            selected ? "text-iris" : "text-transparent",
                          )}
                        >
                          <Check size={12} strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">
                          {m.label}
                        </span>
                        {m.recommended && <Chip tone="iris">Recommended</Chip>}
                      </span>
                      <span className="flex items-baseline gap-2 pl-6 text-[11px]">
                        <span className="min-w-0 flex-1 text-muted">
                          {m.note}
                        </span>
                        <span className="shrink-0 text-faint">
                          {formatCost(m)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SurfaceRow({
  surface,
  label,
  description,
  providers,
  cloudUsable,
  choice,
}: {
  surface: ModelSurface;
  label: string;
  description: string;
  providers: ProvidersInfo;
  cloudUsable: boolean;
  choice: ModelChoice;
}) {
  const fallingBack = choice.provider === "anthropic" && !cloudUsable;

  return (
    <div className="flex items-center justify-between gap-4 rounded-[10px] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-small font-medium text-ink">{label}</p>
        <p className="text-[12px] text-muted">{description}</p>
        {fallingBack && (
          <p className="mt-0.5 text-[11px] text-faint">
            Falling back to local — enable cloud + a valid key
          </p>
        )}
      </div>
      <SurfacePicker
        surface={surface}
        choice={choice}
        providers={providers}
        cloudUsable={cloudUsable}
      />
    </div>
  );
}

/** Cloud opt-in, Anthropic key, and per-surface model routing (§Settings → Models). */
export function ModelsSection() {
  const settings = useSettings((s) => s.settings);
  const providers = useSettings((s) => s.providers);
  const providersLoading = useSettings((s) => s.providersLoading);
  const providersError = useSettings((s) => s.providersError);
  const loadProviders = useSettings((s) => s.loadProviders);
  const setCloudEnabled = useSettings((s) => s.setCloudEnabled);
  const reduce = useReducedMotion();

  const cloudEnabled = settings?.cloudEnabled ?? false;
  const keyState = providers?.anthropic.keyState ?? "none";
  const cloudUsable = cloudEnabled && keyState === "valid";

  return (
    <Panel title="Models">
      {providersLoading && !providers ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : providersError && !providers ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle size={22} strokeWidth={1.5} className="text-faint" />
          <p className="text-small text-muted">{providersError}</p>
          <Button size="sm" onClick={() => void loadProviders()}>
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
          <motion.div
            variants={reduced(reduce, riseIn)}
            className="flex items-start justify-between gap-4 px-3 py-1"
          >
            <div>
              <p className="text-small font-medium text-ink">
                Use cloud models
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                Off by default. Your data stays local unless you turn this on.
              </p>
            </div>
            <Switch
              checked={cloudEnabled}
              onChange={(v) => void setCloudEnabled(v)}
              label="Use cloud models"
            />
          </motion.div>

          {providers && (
            <motion.div variants={reduced(reduce, riseIn)}>
              <ApiKeyRow disabled={!cloudEnabled} />
            </motion.div>
          )}

          {providers && (
            <motion.div
              variants={reduced(reduce, riseIn)}
              className="flex flex-col gap-0.5 border-t border-line pt-3"
            >
              {SURFACES.map((s) => (
                <SurfaceRow
                  key={s.id}
                  surface={s.id}
                  label={s.label}
                  description={s.description}
                  providers={providers}
                  cloudUsable={cloudUsable}
                  choice={
                    settings?.models[s.id] ?? {
                      provider: "ollama",
                      model: providers.ollama.defaultModel,
                    }
                  }
                />
              ))}
            </motion.div>
          )}
        </motion.div>
      )}
    </Panel>
  );
}
