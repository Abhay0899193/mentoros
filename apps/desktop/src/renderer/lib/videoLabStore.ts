import { create } from 'zustand';
import {
  coreClient,
  type VideoGenHistoryEntry,
  type VideoGenJobStatus,
  type VideoGenModelInfo,
} from './coreClient';
import { toast } from '../ui';

/**
 * videoLabStore — Video Lab (text/image-to-video). Single-flight job driven by
 * the `videogen.job` WS event (core broadcasts numeric progress parsed from the
 * two-stage mlx-video output), so no poll loop. In-flight jobs do not survive
 * an app restart — init() only ever finds finished clips via history.
 */

export const DEFAULT_VIDEO_PROMPT =
  'A friendly mentor smiles warmly and waves at the camera, soft studio light, gentle head movement';

/** Wall-clock model from the Stage-0 smoke: ~87 s per 49-frame 512² clip, cost ∝ pixels. */
const MEASURED_SEC_PER_49F_512 = 87;

export function estimateSeconds(width: number, height: number, numFrames: number): number {
  const areaScale = (width * height) / (512 * 512);
  return Math.round(MEASURED_SEC_PER_49F_512 * (numFrames / 49) * areaScale);
}

export interface VideoLabForm {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number | null;
  randomizeSeed: boolean;
  /** Optional I2V source frame (data URI); absent = pure text-to-video. */
  imageDataUri?: string;
  /** Where the source frame came from — for the chip in the form. */
  imageLabel?: string;
}

interface VideoLabState {
  models: VideoGenModelInfo[];
  modelsLoaded: boolean;
  form: VideoLabForm;
  job: VideoGenJobStatus | null;
  starting: boolean;
  history: VideoGenHistoryEntry[];
  historyLoaded: boolean;
  /** History item currently shown in the output pane (null = live job result). */
  viewingHistoryId: string | null;

  init: () => void;
  setForm: (patch: Partial<VideoLabForm>) => void;
  setSourceImage: (dataUri: string | undefined, label?: string) => void;
  generate: () => Promise<void>;
  cancel: () => Promise<void>;
  dismissJob: () => void;
  refreshHistory: () => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  viewHistory: (id: string | null) => void;
  reuseSettings: (item: VideoGenHistoryEntry) => void;
  reuseSeed: (seed: number) => void;
}

let initialized = false;

export const useVideoLab = create<VideoLabState>((set, get) => ({
  models: [],
  modelsLoaded: false,
  form: {
    modelId: 'ltx-local',
    prompt: DEFAULT_VIDEO_PROMPT,
    width: 512,
    height: 512,
    numFrames: 49,
    fps: 24,
    seed: null,
    randomizeSeed: true,
  },
  job: null,
  starting: false,
  history: [],
  historyLoaded: false,
  viewingHistoryId: null,

  init: () => {
    if (initialized) return;
    initialized = true;
    void coreClient
      .videogenModels()
      .then((models) => {
        set({ models, modelsLoaded: true });
        const preferred = models.find((m) => m.id === 'ltx-local') ?? models[0];
        if (preferred) {
          set((s) => ({
            form: { ...s.form, modelId: preferred.id, numFrames: preferred.defaultFrames, fps: preferred.defaultFps },
          }));
        }
      })
      .catch(() => set({ modelsLoaded: true }));
    void get().refreshHistory();
    // Progress/result stream over WS — only track the job this store started.
    coreClient.on('videogen.job', (status) => {
      const current = get().job;
      if (!current || current.id !== status.id) return;
      set({ job: status });
      if (status.state === 'done') void get().refreshHistory();
    });
  },

  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),

  setSourceImage: (dataUri, label) =>
    set((s) => ({ form: { ...s.form, imageDataUri: dataUri, imageLabel: dataUri ? label : undefined } })),

  generate: async () => {
    const { form, job, starting } = get();
    if (starting || (job && ['queued', 'running'].includes(job.state))) return;
    set({ starting: true, viewingHistoryId: null });
    try {
      const res = await coreClient.videogenGenerate({
        modelId: form.modelId,
        prompt: form.prompt,
        width: form.width,
        height: form.height,
        numFrames: form.numFrames,
        fps: form.fps,
        seed: form.randomizeSeed || form.seed === null ? undefined : form.seed,
        randomizeSeed: form.randomizeSeed,
        image: form.imageDataUri,
      });
      set({ starting: false, job: res.job });
    } catch (err) {
      set({ starting: false });
      toast({
        tone: 'danger',
        title: 'Could not start the video',
        description: err instanceof Error ? err.message : 'Unknown error.',
      });
    }
  },

  cancel: async () => {
    const job = get().job;
    if (!job) return;
    try {
      await coreClient.videogenCancelJob(job.id);
    } catch {
      /* terminal already — the WS event settles the card */
    }
  },

  dismissJob: () => {
    const job = get().job;
    if (job && (job.state === 'done' || job.state === 'error' || job.state === 'cancelled')) set({ job: null });
  },

  refreshHistory: async () => {
    try {
      const history = await coreClient.videogenHistory();
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
      await coreClient.videogenDeleteHistory(id);
    } catch {
      set({ history: prev });
      toast({
        tone: 'danger',
        title: 'Could not delete the clip',
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
        numFrames: item.numFrames,
        fps: item.fps,
        seed: item.seed,
        randomizeSeed: false,
      },
    })),

  reuseSeed: (seed) => set((s) => ({ form: { ...s.form, seed, randomizeSeed: false } })),
}));
