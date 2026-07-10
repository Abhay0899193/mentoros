import { create } from 'zustand';
import {
  coreClient,
  type CustomFacePreset,
  type CreateFacePresetInput,
  type FaceJobStatus,
  type FacePresetId,
  type FaceToolchainStatus,
} from './coreClient';
import type { RealisticPreset } from '../orb/faces/realistic';
import { toast } from '../ui';

/**
 * faceStore — custom face presets (created from the user's own photos) and
 * the one-at-a-time generation job. Custom presets are adapted into the
 * RealisticPreset shape so RealisticPortrait / the Identity gallery render
 * bundled and user-created presets identically.
 */

function toRealistic(p: CustomFacePreset): RealisticPreset {
  return {
    id: p.id,
    name: p.name,
    vibe: 'Created from your photos.',
    accent: p.accent,
    custom: true,
    portrait: {
      base: p.portrait.base,
      mouthSmall: p.portrait.mouthSmall,
      mouthOpen: p.portrait.mouthOpen,
      mouthWide: p.portrait.mouthWide,
      blink: p.portrait.blink,
    },
    full: p.full ?? p.portrait.base,
    config: p.config,
  };
}

interface FaceState {
  /** Finished custom presets, already adapted for the portrait player. */
  customPresets: RealisticPreset[];
  presetsLoaded: boolean;
  toolchain: FaceToolchainStatus | null;
  /** The in-flight (or terminal, until dismissed) generation job. */
  job: FaceJobStatus | null;
  creating: boolean;
  init: () => void;
  refreshToolchain: () => Promise<FaceToolchainStatus | null>;
  create: (input: CreateFacePresetInput) => Promise<boolean>;
  cancelJob: () => Promise<void>;
  /** Clear a terminal (done/error/cancelled) job card. */
  dismissJob: () => void;
  remove: (id: FacePresetId) => Promise<void>;
}

let initialized = false;

export const useFaces = create<FaceState>((set, get) => ({
  customPresets: [],
  presetsLoaded: false,
  toolchain: null,
  job: null,
  creating: false,

  init: () => {
    if (initialized) return;
    initialized = true;
    void coreClient
      .listCustomFacePresets()
      .then((presets) => set({ customPresets: presets.map(toRealistic), presetsLoaded: true }))
      .catch(() => set({ presetsLoaded: true }));
    void coreClient
      .activeFaceJob()
      .then((job) => {
        // A terminal job from a previous app run is stale — only resume live ones.
        if (job && ['queued', 'generating', 'compositing'].includes(job.state)) set({ job });
      })
      .catch(() => undefined);
    coreClient.on('faces.changed', ({ presets }) => {
      set({ customPresets: presets.map(toRealistic), presetsLoaded: true });
    });
    coreClient.on('face.job', (job) => {
      set({ job });
      if (job.state === 'done') {
        toast({
          tone: 'success',
          title: 'Face preset ready',
          description: `${job.name} joined your gallery.`,
        });
      }
    });
  },

  refreshToolchain: async () => {
    try {
      const toolchain = await coreClient.faceToolchainStatus();
      set({ toolchain });
      return toolchain;
    } catch {
      set({ toolchain: null });
      return null;
    }
  },

  create: async (input) => {
    set({ creating: true });
    try {
      const { job } = await coreClient.createFacePreset(input);
      set({ job, creating: false });
      return true;
    } catch (err) {
      set({ creating: false });
      toast({
        tone: 'danger',
        title: 'Could not start generation',
        description: err instanceof Error ? err.message : 'Unknown error.',
      });
      return false;
    }
  },

  cancelJob: async () => {
    const job = get().job;
    if (!job) return;
    try {
      await coreClient.cancelFaceJob(job.jobId);
    } catch {
      /* terminal already — the face.job event settles the card */
    }
  },

  dismissJob: () => {
    const job = get().job;
    if (job && ['done', 'error', 'cancelled'].includes(job.state)) set({ job: null });
  },

  remove: async (id) => {
    const prev = get().customPresets;
    set({ customPresets: prev.filter((p) => p.id !== id) });
    try {
      await coreClient.deleteFacePreset(id);
    } catch {
      set({ customPresets: prev });
      toast({
        tone: 'danger',
        title: 'Could not delete preset',
        action: { label: 'Retry', onClick: () => void get().remove(id) },
      });
    }
  },
}));

/** Resolve a custom preset by id for the player (built-ins use their own map). */
export function customPreset(id: FacePresetId): RealisticPreset | undefined {
  return useFaces.getState().customPresets.find((p) => p.id === id);
}
