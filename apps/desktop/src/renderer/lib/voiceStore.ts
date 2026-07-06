import { create } from 'zustand';
import { coreClient, type VoiceChannel, type VoiceStatus, type Segment } from './coreClient';
import { transition, type OrbState } from '../orb/orbState';
import { startMicCapture, STT_SAMPLE_RATE, type MicCapture } from './micCapture';
import { TtsPlayer } from './ttsPlayer';
import { useChat } from './chatStore';

interface InstallProgress {
  step: string;
  completedBytes: number;
  totalBytes: number;
  active: boolean;
  error?: string;
}

interface VoiceStoreState {
  orb: OrbState;
  /** Soft (interim) transcript while listening. */
  interim: string;
  /** Last finalized utterance. */
  finalTranscript: string;
  /** Accumulated mentor reply text (displayed under the Orb). */
  reply: string;
  status: VoiceStatus | null;
  install: InstallProgress | null;
  error: string | null;

  enter: () => void;
  leave: () => void;
  pttDown: () => Promise<void>;
  pttUp: () => void;
  interrupt: () => void;
  refreshStatus: () => Promise<void>;
  startInstall: () => Promise<void>;
}

/* Module-level machinery (not reactive state) */
const ttsPlayer = new TtsPlayer();
let channel: VoiceChannel | null = null;
let mic: MicCapture | null = null;
let wired = false;
let assistantId: string | null = null;
let segments: Partial<Record<Segment, string>> = {};
let transcriptTimeout: ReturnType<typeof setTimeout> | null = null;

export const micLevelRef: React.MutableRefObject<number> = { current: 0 };
export const ttsLevelRef = ttsPlayer.levelRef;

declare global {
  interface Window {
    __voice?: unknown;
  }
}

export const useVoice = create<VoiceStoreState>((set, get) => {
  const dispatch = (event: Parameters<typeof transition>[1]) =>
    set((s) => ({ orb: transition(s.orb, event) }));

  async function ensureThread(): Promise<string> {
    const chat = useChat.getState();
    if (chat.activeThreadId) return chat.activeThreadId;
    const t = await coreClient.createThread();
    useChat.setState({ activeThreadId: t.id });
    void chat.refreshThreads();
    return t.id;
  }

  async function generateReply(text: string): Promise<void> {
    dispatch({ type: 'GENERATION_STARTED' });
    set({ reply: '' });
    segments = {};
    const threadId = await ensureThread();
    const persona = useChat.getState().persona;
    const res = await coreClient.sendMessage(threadId, text, persona, 'voice');
    assistantId = res.assistantMessageId;
  }

  function speakReply(): void {
    // Hints-first spoken answer (§4.3): voice speaks prose + Hint 1 only;
    // deeper rungs stay behind the ladder in the Chat thread.
    const spoken = [segments.prose, segments.hint1].filter(Boolean).join('\n\n').trim();
    if (spoken === '') {
      dispatch({ type: 'CANCEL' });
      return;
    }
    void coreClient.speak(spoken).catch(() => {
      set({ error: 'Speech synthesis failed — the answer is in your Chat thread.' });
      dispatch({ type: 'ERROR' });
    });
  }

  function wireOnce(): void {
    if (wired) return;
    wired = true;

    coreClient.on('chat.token', ({ messageId, segment, token }) => {
      if (messageId !== assistantId) return;
      segments[segment] = (segments[segment] ?? '') + token;
      if (segment === 'prose' || segment === 'hint1') {
        set({ reply: [segments.prose, segments.hint1].filter(Boolean).join('\n\n') });
      }
    });

    coreClient.on('chat.status', ({ messageId, phase, error }) => {
      if (messageId !== assistantId) return;
      if (phase === 'done') speakReply();
      if (phase === 'error') {
        set({ error: error ?? 'The mentor could not answer.' });
        dispatch({ type: 'ERROR' });
      }
    });

    coreClient.on('voice.status', (status) => set({ status }));

    coreClient.on('voice.install', (p) =>
      set({
        install: {
          step: p.step,
          completedBytes: p.completedBytes,
          totalBytes: p.totalBytes,
          active: !p.done,
          error: p.error,
        },
      }),
    );

    // Global ⌥Space acts as a toggle (see main-process registration).
    coreClient.on('voice.ptt', () => {
      const { orb } = get();
      if (orb === 'listening') get().pttUp();
      else void get().pttDown();
    });
  }

  function openChannel(): VoiceChannel {
    if (channel) return channel;
    channel = coreClient.openVoiceChannel({
      onTranscript: ({ text, final }) => {
        if (!final) {
          set({ interim: text });
          return;
        }
        if (transcriptTimeout) clearTimeout(transcriptTimeout);
        set({ interim: '', finalTranscript: text });
        if (text.trim() === '') {
          set({ error: 'I didn’t catch that — hold and try again.' });
          dispatch({ type: 'CANCEL' });
          return;
        }
        // A slow whisper run (cold start, big model) can outlive the deadline
        // below — if the words still arrived, answer them instead of stranding
        // the user with their own transcript next to a timeout error.
        const lateButUsable =
          get().orb === 'idle' && get().error?.startsWith('Transcription timed out');
        if (get().orb === 'thinking' || lateButUsable) {
          if (lateButUsable) set({ error: null });
          void generateReply(text);
        }
      },
      onTtsStart: (sampleRate) => {
        ttsPlayer.start(sampleRate, () => dispatch({ type: 'TTS_ENDED' }));
        dispatch({ type: 'TTS_STARTED' });
      },
      onTtsChunk: (pcm) => ttsPlayer.enqueue(pcm),
      onTtsEnd: () => ttsPlayer.end(),
      onError: (message) => {
        set({ error: message });
        dispatch({ type: 'ERROR' });
      },
    });
    return channel;
  }

  return {
    orb: 'idle',
    interim: '',
    finalTranscript: '',
    reply: '',
    status: null,
    install: null,
    error: null,

    enter: () => {
      wireOnce();
      openChannel();
      void get().refreshStatus();
    },

    leave: () => {
      mic?.stop();
      mic = null;
      ttsPlayer.stop();
      set({ orb: 'idle', interim: '' });
    },

    pttDown: async () => {
      const { orb, status } = get();
      if (orb === 'listening') return;
      if (status && status.stt !== 'ready') {
        set({ error: 'Speech recognition isn’t installed yet — use “Install voice” below.' });
        return;
      }
      set({ error: null, interim: '', finalTranscript: '', reply: '' });
      if (orb === 'speaking') {
        // Barge-in: duck the mentor instantly and listen (§4.3).
        channel?.stopTts();
        ttsPlayer.duck();
      }
      dispatch({ type: 'PTT_DOWN' });
      const ch = openChannel();
      ch.micStart(STT_SAMPLE_RATE);
      mic = await startMicCapture({
        levelRef: micLevelRef,
        onChunk: (pcm) => ch.sendPcm(pcm),
        onError: (message) => {
          set({ error: message });
          dispatch({ type: 'ERROR' });
        },
      });
    },

    pttUp: () => {
      if (get().orb !== 'listening') return;
      mic?.stop();
      mic = null;
      channel?.micStop();
      dispatch({ type: 'PTT_UP' });
      // Generous deadline: a cold whisper start (one-time Metal shader
      // compile) or a larger STT model can legitimately take >8s; late
      // arrivals are also recovered in onTranscript above.
      transcriptTimeout = setTimeout(() => {
        if (get().orb === 'thinking' && get().finalTranscript === '') {
          set({ error: 'Transcription timed out — try again.' });
          set({ orb: 'idle' });
        }
      }, 20000);
    },

    interrupt: () => {
      mic?.stop();
      mic = null;
      channel?.stopTts();
      ttsPlayer.duck();
      if (assistantId) void coreClient.stopGeneration(assistantId).catch(() => undefined);
      dispatch({ type: 'CANCEL' });
    },

    refreshStatus: async () => {
      try {
        set({ status: await coreClient.voiceStatus() });
      } catch {
        set({ status: null });
      }
    },

    startInstall: async () => {
      set({ install: { step: 'Starting…', completedBytes: 0, totalBytes: 0, active: true } });
      try {
        await coreClient.installVoice();
      } catch {
        set({
          install: { step: 'Install', completedBytes: 0, totalBytes: 0, active: false, error: 'Install failed to start.' },
        });
      }
    },
  };
});

// Dev-only: lets vision self-verification (CDP) drive Orb states without a
// human at the mic. Stripped from production bundles by the DEV guard.
if (import.meta.env.DEV) {
  window.__voice = useVoice;
}
