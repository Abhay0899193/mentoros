import { create } from 'zustand';
import {
  coreClient,
  type AppSettings,
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

  init: () => void;
  loadSettings: () => Promise<void>;
  loadVoices: () => Promise<void>;
  loadSttModels: () => Promise<void>;

  setVoice: (id: string) => Promise<void>;
  setSttModel: (id: SttModelId) => Promise<void>;
  setMentorIdentity: (v: AppSettings['mentorIdentity']) => Promise<void>;

  downloadModel: (id: SttModelId) => Promise<void>;

  previewVoice: (id: string) => void;
  stopPreview: () => void;
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
}));
