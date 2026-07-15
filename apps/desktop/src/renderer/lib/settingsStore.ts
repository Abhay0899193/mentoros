import { create } from 'zustand';
import {
  coreClient,
  type ApiKeyState,
  type AppSettings,
  type CustomEndpointInfo,
  type EndpointAuth,
  type EndpointKind,
  type ModelChoice,
  type ModelSurface,
  type Persona,
  type ProvidersInfo,
  type SttModelId,
  type SttModelInfo,
  type TtsVoiceInfo,
} from './coreClient';
import { toast } from '../ui';

interface DownloadProgress {
  completedBytes: number;
  totalBytes: number;
}

interface SettingsState {
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  voices: TtsVoiceInfo[];
  voicesLoading: boolean;
  voicesLoaded: boolean;
  voicesError: string | null;

  sttModels: SttModelInfo[];
  sttLoading: boolean;
  sttLoaded: boolean;
  sttError: string | null;

  downloadProgress: Partial<Record<SttModelId, DownloadProgress>>;

  previewingVoiceId: string | null;
  previewLoadingId: string | null;
  previewErrorId: string | null;

  providers: ProvidersInfo | null;
  providersLoading: boolean;
  providersLoaded: boolean;
  providersError: string | null;
  keySaving: boolean;
  endpointSaving: boolean;

  init: () => void;
  loadSettings: () => Promise<void>;
  loadVoices: () => Promise<void>;
  loadSttModels: () => Promise<void>;
  loadProviders: () => Promise<void>;

  setVoice: (id: string) => Promise<void>;
  setSttModel: (id: SttModelId) => Promise<void>;
  setMentorIdentity: (v: AppSettings['mentorIdentity']) => Promise<void>;
  /** Patch any of the face-gallery keys (preset / glam / maturity / view / identity) together. */
  setMentorLook: (
    patch: Partial<
      Pick<AppSettings, 'mentorIdentity' | 'mentorFace' | 'faceGlam' | 'faceMaturity' | 'faceView'>
    >,
  ) => Promise<void>;

  downloadModel: (id: SttModelId) => Promise<void>;

  previewVoice: (id: string) => void;
  stopPreview: () => void;

  /** Switches the default persona for new chat/voice threads; may also change face/voice (core merges). */
  setActivePersona: (id: Persona) => Promise<void>;
  setCloudEnabled: (enabled: boolean) => Promise<void>;
  /** Opt-in LAN exposure; the bind change applies on the next launch. */
  setLanAccess: (enabled: boolean) => Promise<void>;
  /** Resolves to the resulting key state, or null if the request itself failed (no round trip). */
  saveAnthropicKey: (key: string) => Promise<ApiKeyState | null>;
  removeAnthropicKey: () => Promise<void>;
  setSurfaceModel: (surface: ModelSurface, choice: ModelChoice) => Promise<void>;

  /* custom endpoints (Settings → Models → Custom endpoints) */
  createEndpoint: (input: {
    label: string;
    kind: EndpointKind;
    baseUrl: string;
    auth?: EndpointAuth;
    models?: string[];
    token?: string;
  }) => Promise<CustomEndpointInfo | null>;
  updateEndpoint: (
    id: string,
    patch: Partial<{
      label: string;
      kind: EndpointKind;
      baseUrl: string;
      auth: EndpointAuth;
      models: string[];
      token: string;
    }>,
  ) => Promise<CustomEndpointInfo | null>;
  deleteEndpoint: (id: string) => Promise<void>;
  /** Pass-through — no store state; callers own their own loading/error UI. */
  testEndpoint: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Pass-through — no store state; callers own their own loading/error UI. */
  fetchEndpointModels: (id: string) => Promise<string[]>;
}

let initialized = false;
let previewAudio: HTMLAudioElement | null = null;

function stopPreviewAudio(): void {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  settingsLoading: false,
  settingsError: null,

  voices: [],
  voicesLoading: false,
  voicesLoaded: false,
  voicesError: null,

  sttModels: [],
  sttLoading: false,
  sttLoaded: false,
  sttError: null,

  downloadProgress: {},

  previewingVoiceId: null,
  previewLoadingId: null,
  previewErrorId: null,

  providers: null,
  providersLoading: false,
  providersLoaded: false,
  providersError: null,
  keySaving: false,
  endpointSaving: false,

  init: () => {
    if (!initialized) {
      initialized = true;

      coreClient.on('settings.changed', ({ settings }) => set({ settings }));

      coreClient.on('voice.model', (p) => {
        set((s) => ({
          downloadProgress: {
            ...s.downloadProgress,
            [p.model]: { completedBytes: p.completedBytes, totalBytes: p.totalBytes },
          },
        }));
        if (p.done) {
          if (p.error) {
            toast({
              tone: 'danger',
              title: `Couldn't download ${p.model}`,
              description: p.error,
              action: { label: 'Retry', onClick: () => void get().downloadModel(p.model) },
            });
          }
          void get().loadSttModels();
        }
      });
    }
    void get().loadSettings();
    void get().loadVoices();
    void get().loadSttModels();
    void get().loadProviders();
  },

  loadSettings: async () => {
    set({ settingsLoading: !get().settings, settingsError: null });
    try {
      const settings = await coreClient.getSettings();
      set({ settings, settingsLoading: false });
    } catch {
      set({ settingsLoading: false, settingsError: 'The settings service did not respond.' });
    }
  },

  loadVoices: async () => {
    set({ voicesLoading: !get().voicesLoaded, voicesError: null });
    try {
      const voices = await coreClient.listTtsVoices();
      set({ voices, voicesLoading: false, voicesLoaded: true });
    } catch {
      set({ voices: [], voicesLoading: false, voicesLoaded: true, voicesError: 'Could not load mentor voices.' });
    }
  },

  loadSttModels: async () => {
    set({ sttLoading: !get().sttLoaded, sttError: null });
    try {
      const sttModels = await coreClient.listSttModels();
      set({ sttModels, sttLoading: false, sttLoaded: true });
    } catch {
      set({ sttLoading: false, sttLoaded: true, sttError: 'Could not load transcription models.' });
    }
  },

  loadProviders: async () => {
    set({ providersLoading: !get().providersLoaded, providersError: null });
    try {
      const providers = await coreClient.listProviders();
      set({ providers, providersLoading: false, providersLoaded: true });
    } catch {
      set({ providersLoading: false, providersLoaded: true, providersError: 'Could not load model providers.' });
    }
  },

  setVoice: async (id) => {
    const prev = get().settings;
    if (!prev || prev.ttsVoice === id) return;
    set({ settings: { ...prev, ttsVoice: id } });
    try {
      const settings = await coreClient.updateSettings({ ttsVoice: id });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not change mentor voice',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setVoice(id) },
      });
    }
  },

  setSttModel: async (id) => {
    const prev = get().settings;
    if (!prev || prev.sttModel === id) return;
    set({ settings: { ...prev, sttModel: id } });
    try {
      const settings = await coreClient.updateSettings({ sttModel: id });
      set({ settings });
      void get().loadSttModels();
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not switch transcription model',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setSttModel(id) },
      });
    }
  },

  setMentorIdentity: async (v) => {
    const prev = get().settings;
    if (!prev || prev.mentorIdentity === v) return;
    set({ settings: { ...prev, mentorIdentity: v } });
    try {
      const settings = await coreClient.updateSettings({ mentorIdentity: v });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not change mentor identity',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setMentorIdentity(v) },
      });
    }
  },

  setMentorLook: async (patch) => {
    const prev = get().settings;
    if (!prev) return;
    if ((Object.keys(patch) as Array<keyof typeof patch>).every((k) => prev[k] === patch[k])) {
      return;
    }
    set({ settings: { ...prev, ...patch } });
    try {
      const settings = await coreClient.updateSettings(patch);
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not update the mentor look',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setMentorLook(patch) },
      });
    }
  },

  downloadModel: async (id) => {
    set((s) => ({
      downloadProgress: { ...s.downloadProgress, [id]: { completedBytes: 0, totalBytes: 0 } },
      sttModels: s.sttModels.map((m) => (m.id === id ? { ...m, state: 'downloading' } : m)),
    }));
    try {
      await coreClient.downloadSttModel(id);
    } catch {
      toast({
        tone: 'danger',
        title: "Couldn't start download",
        description: 'The voice service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().downloadModel(id) },
      });
      void get().loadSttModels();
    }
  },

  previewVoice: (id) => {
    stopPreviewAudio();
    set({ previewingVoiceId: null, previewLoadingId: id, previewErrorId: null });
    const audio = new Audio(coreClient.voicePreviewUrl(id));
    previewAudio = audio;

    const onFail = () => {
      if (previewAudio !== audio) return;
      previewAudio = null;
      set({ previewLoadingId: null, previewingVoiceId: null, previewErrorId: id });
    };

    audio.addEventListener(
      'canplay',
      () => {
        if (previewAudio !== audio) return;
        set({ previewLoadingId: null, previewingVoiceId: id });
      },
      { once: true },
    );
    audio.addEventListener(
      'ended',
      () => {
        if (previewAudio !== audio) return;
        previewAudio = null;
        set({ previewingVoiceId: null });
      },
      { once: true },
    );
    audio.addEventListener('error', onFail, { once: true });
    void audio.play().catch(onFail);
  },

  stopPreview: () => {
    stopPreviewAudio();
    set({ previewingVoiceId: null, previewLoadingId: null });
  },

  setActivePersona: async (id) => {
    const prev = get().settings;
    if (!prev || prev.activePersona === id) return;
    set({ settings: { ...prev, activePersona: id } });
    try {
      const settings = await coreClient.updateSettings({ activePersona: id });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not switch persona',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setActivePersona(id) },
      });
    }
  },

  setCloudEnabled: async (enabled) => {
    const prev = get().settings;
    if (!prev || prev.cloudEnabled === enabled) return;
    set({ settings: { ...prev, cloudEnabled: enabled } });
    try {
      const settings = await coreClient.updateSettings({ cloudEnabled: enabled });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not update cloud setting',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setCloudEnabled(enabled) },
      });
    }
  },

  setLanAccess: async (enabled) => {
    const prev = get().settings;
    if (!prev || prev.lanAccess === enabled) return;
    set({ settings: { ...prev, lanAccess: enabled } });
    try {
      const settings = await coreClient.updateSettings({ lanAccess: enabled });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: 'Could not update device access',
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setLanAccess(enabled) },
      });
    }
  },

  saveAnthropicKey: async (key) => {
    set({ keySaving: true });
    try {
      const res = await coreClient.setAnthropicKey(key);
      set((s) => ({
        keySaving: false,
        providers: s.providers
          ? {
              ...s.providers,
              anthropic: { ...s.providers.anthropic, keyState: res.keyState, keyMask: res.keyMask, keyError: res.keyError },
            }
          : s.providers,
      }));
      return res.keyState;
    } catch {
      set({ keySaving: false });
      toast({
        tone: 'danger',
        title: 'Could not save the API key',
        description: 'The settings service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().saveAnthropicKey(key) },
      });
      return null;
    }
  },

  removeAnthropicKey: async () => {
    const prev = get().providers;
    if (!prev || prev.anthropic.keyState === 'none') return;
    set({ providers: { ...prev, anthropic: { ...prev.anthropic, keyState: 'none', keyMask: undefined, keyError: undefined } } });
    try {
      await coreClient.clearAnthropicKey();
    } catch {
      set({ providers: prev });
      toast({
        tone: 'danger',
        title: 'Could not remove the API key',
        description: 'The settings service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().removeAnthropicKey() },
      });
    }
  },

  setSurfaceModel: async (surface, choice) => {
    const prev = get().settings;
    if (!prev) return;
    const prevChoice = prev.models[surface];
    if (prevChoice.provider === choice.provider && prevChoice.model === choice.model) return;
    const models = { ...prev.models, [surface]: choice };
    set({ settings: { ...prev, models } });
    try {
      const settings = await coreClient.updateSettings({ models });
      set({ settings });
    } catch {
      set({ settings: prev });
      toast({
        tone: 'danger',
        title: `Could not update the ${surface} model`,
        description: 'The settings service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setSurfaceModel(surface, choice) },
      });
    }
  },

  createEndpoint: async (input) => {
    set({ endpointSaving: true });
    try {
      const endpoint = await coreClient.createEndpoint(input);
      set({ endpointSaving: false });
      void get().loadProviders();
      return endpoint;
    } catch {
      set({ endpointSaving: false });
      toast({
        tone: 'danger',
        title: 'Could not create the endpoint',
        description: 'The settings service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().createEndpoint(input) },
      });
      return null;
    }
  },

  updateEndpoint: async (id, patch) => {
    set({ endpointSaving: true });
    try {
      const endpoint = await coreClient.updateEndpoint(id, patch);
      set({ endpointSaving: false });
      void get().loadProviders();
      return endpoint;
    } catch {
      set({ endpointSaving: false });
      toast({
        tone: 'danger',
        title: 'Could not update the endpoint',
        description: 'The settings service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().updateEndpoint(id, patch) },
      });
      return null;
    }
  },

  deleteEndpoint: async (id) => {
    try {
      await coreClient.deleteEndpoint(id);
      void get().loadProviders();
    } catch {
      toast({
        tone: 'danger',
        title: 'Could not delete the endpoint',
        description: 'The settings service did not respond — try again.',
        action: { label: 'Retry', onClick: () => void get().deleteEndpoint(id) },
      });
    }
  },

  testEndpoint: (id) => coreClient.testEndpoint(id),
  fetchEndpointModels: (id) => coreClient.fetchEndpointModels(id),
}));
