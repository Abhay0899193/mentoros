import { create } from 'zustand';
import {
  coreClient,
  type ImageGenHistoryItem,
  type ImageGenJobStatus,
  type ImageGenModelInfo,
  type ApiKeyState,
} from './coreClient';
import { toast } from '../ui';

/**
 * imageLabStore — Image Lab (text-to-image playground). Single-flight job:
 * the store owns the poll loop (~600ms) and self-clears it on a terminal
 * state, mirroring how faceStore keeps its one active job global. In-flight
 * jobs do not survive an app restart, so init() only ever sees terminal jobs
 * via history — there is nothing to resume.
 */

const POLL_MS = 600;

export const DEFAULT_PROMPT =
  'Portrait of a friendly senior engineering mentor, warm studio light, neutral gray backdrop, photorealistic, 4k';

export interface ImageLabForm {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  randomizeSeed: boolean;
  referenceDataUri?: string;
}

interface ImageLabState {
  models: ImageGenModelInfo[];
  modelsLoaded: boolean;
  form: ImageLabForm;
  job: ImageGenJobStatus | null;
  starting: boolean;
  history: ImageGenHistoryItem[];
  historyLoaded: boolean;
  /** History item currently shown in the output pane (null = live job result). */
  viewingHistoryId: string | null;
  falKeyState: ApiKeyState;
  falKeyMask?: string;
  falKeySaving: boolean;

  init: () => void;
  setForm: (patch: Partial<ImageLabForm>) => void;
  selectModel: (modelId: string) => void;
  generate: () => Promise<void>;
  cancel: () => Promise<void>;
  dismissJob: () => void;
  refreshHistory: () => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  viewHistory: (id: string | null) => void;
  reuseSettings: (item: ImageGenHistoryItem) => void;
  reuseSeed: (seed: number) => void;
  saveFalKey: (key: string) => Promise<boolean>;
  clearFalKey: () => Promise<void>;
}

let initialized = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export const useImageLab = create<ImageLabState>((set, get) => ({
  models: [],
  modelsLoaded: false,
  form: {
    modelId: 'z-image-turbo-local',
    prompt: DEFAULT_PROMPT,
    width: 1024,
    height: 1024,
    steps: 8,
    seed: null,
    randomizeSeed: true,
  },
  job: null,
  starting: false,
  history: [],
  historyLoaded: false,
  viewingHistoryId: null,
  falKeyState: 'none',
  falKeySaving: false,

  init: () => {
    if (initialized) return;
    initialized = true;
    void coreClient
      .imagegenModels()
      .then((models) => {
        set({ models, modelsLoaded: true });
        const preferred = models.find((m) => m.id === 'z-image-turbo-local') ?? models[0];
        if (preferred) {
          set((s) => ({ form: { ...s.form, modelId: preferred.id, steps: preferred.defaultSteps } }));
        }
      })
      .catch(() => set({ modelsLoaded: true }));
    void get().refreshHistory();
    void coreClient
      .falKeyStatus()
      .then(({ keyState, keyMask }) => set({ falKeyState: keyState, falKeyMask: keyMask }))
      .catch(() => undefined);
  },

  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),

  selectModel: (modelId) => {
    const model = get().models.find((m) => m.id === modelId);
    set((s) => ({
      form: {
        ...s.form,
        modelId,
        steps: model?.defaultSteps ?? s.form.steps,
        referenceDataUri: model?.requiresReference ? s.form.referenceDataUri : undefined,
      },
    }));
  },

  generate: async () => {
    const { form } = get();
    if (get().starting || (get().job && ['queued', 'running'].includes(get().job!.state))) return;
    set({ starting: true, viewingHistoryId: null });
    try {
      const { jobId } = await coreClient.imagegenGenerate({
        modelId: form.modelId,
        prompt: form.prompt,
        width: form.width,
        height: form.height,
        steps: form.steps,
        seed: form.randomizeSeed || form.seed === null ? undefined : form.seed,
        randomizeSeed: form.randomizeSeed,
        referenceDataUri: form.referenceDataUri,
      });
      set({ starting: false, job: { id: jobId, state: 'queued' } });
      stopPolling();
      pollTimer = setInterval(async () => {
        try {
          const status = await coreClient.imagegenJob(jobId);
          if (!status) {
            stopPolling();
            return;
          }
          set({ job: status });
          if (status.state === 'done' || status.state === 'error') {
            stopPolling();
            if (status.state === 'done') void get().refreshHistory();
          }
        } catch {
          /* transient — next tick retries */
        }
      }, POLL_MS);
    } catch (err) {
      set({ starting: false });
      toast({
        tone: 'danger',
        title: 'Could not start generation',
        description: err instanceof Error ? err.message : 'Unknown error.',
      });
    }
  },

  cancel: async () => {
    const job = get().job;
    if (!job) return;
    try {
      await coreClient.imagegenCancel(job.id);
    } catch {
      /* terminal already — the next poll tick settles the card */
    }
  },

  dismissJob: () => {
    const job = get().job;
    if (job && (job.state === 'done' || job.state === 'error')) set({ job: null });
  },

  refreshHistory: async () => {
    try {
      const history = await coreClient.imagegenHistory();
      set({ history, historyLoaded: true });
    } catch {
      set({ historyLoaded: true });
    }
  },

  deleteHistory: async (id) => {
    const prev = get().history;
    set({
      history: prev.filter((h) => h.id !== id),
      viewingHistoryId: get().viewingHistoryId === id ? null : get().viewingHistoryId,
    });
    try {
      await coreClient.imagegenDeleteHistory(id);
    } catch {
      set({ history: prev });
      toast({
        tone: 'danger',
        title: 'Could not delete image',
        action: { label: 'Retry', onClick: () => void get().deleteHistory(id) },
      });
    }
  },

  viewHistory: (id) => set({ viewingHistoryId: id }),

  reuseSettings: (item) =>
    set((s) => ({
      viewingHistoryId: null,
      form: {
        ...s.form,
        modelId: item.modelId,
        prompt: item.prompt,
        width: item.width,
        height: item.height,
        steps: item.steps,
        seed: item.seed,
        randomizeSeed: false,
      },
    })),

  reuseSeed: (seed) => set((s) => ({ form: { ...s.form, seed, randomizeSeed: false } })),

  saveFalKey: async (key) => {
    set({ falKeySaving: true });
    try {
      const res = await coreClient.setFalKey(key);
      set({ falKeySaving: false, falKeyState: res.keyState, falKeyMask: res.keyMask });
      return true;
    } catch (err) {
      set({ falKeySaving: false });
      toast({
        tone: 'danger',
        title: 'Could not save the fal.ai key',
        description: err instanceof Error ? err.message : 'Try again.',
      });
      return false;
    }
  },

  clearFalKey: async () => {
    const prevState = get().falKeyState;
    const prevMask = get().falKeyMask;
    set({ falKeyState: 'none', falKeyMask: undefined });
    try {
      await coreClient.clearFalKey();
    } catch {
      set({ falKeyState: prevState, falKeyMask: prevMask });
      toast({ tone: 'danger', title: 'Could not remove the key' });
    }
  },
}));
