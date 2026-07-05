import { create } from 'zustand';
import {
  coreClient,
  type ChatMessage,
  type ChatPhase,
  type ModelStatus,
  type Persona,
  type ThreadSummary,
} from './coreClient';

interface PullProgress {
  active: boolean;
  completedBytes: number;
  totalBytes: number;
  error?: string;
}

interface ChatState {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  persona: Persona;
  /** Non-null while an assistant message is being generated. */
  streamingMessageId: string | null;
  phase: ChatPhase | null;
  generationError: string | null;
  modelStatus: ModelStatus | null;
  pull: PullProgress | null;
  /** messageId → highest revealed ladder rung (1 hint1 … 4 solution). */
  revealed: Record<string, number>;

  init: () => void;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string | null) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  send: (content: string) => Promise<void>;
  stop: () => Promise<void>;
  setPersona: (p: Persona) => void;
  reveal: (messageId: string, level: number) => void;
  refreshModelStatus: () => Promise<void>;
  startPull: () => Promise<void>;
}

let initialized = false;

export const useChat = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: [],
  persona: 'staff-engineer',
  streamingMessageId: null,
  phase: null,
  generationError: null,
  modelStatus: null,
  pull: null,
  revealed: {},

  init: () => {
    if (initialized) return;
    initialized = true;

    coreClient.on('chat.token', ({ messageId, segment, token }) => {
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== messageId) return m;
          const segments = [...m.segments];
          const last = segments[segments.length - 1];
          if (last && last.segment === segment) {
            segments[segments.length - 1] = { segment, content: last.content + token };
          } else {
            segments.push({ segment, content: token });
          }
          return { ...m, segments };
        }),
      }));
    });

    coreClient.on('chat.status', ({ messageId, phase, error }) => {
      const finished = phase === 'done' || phase === 'error' || phase === 'stopped';
      set({
        phase,
        streamingMessageId: finished ? null : messageId,
        generationError: phase === 'error' ? (error ?? 'Generation failed.') : null,
      });
      if (finished) void get().refreshThreads();
      if (phase === 'error') void get().refreshModelStatus();
    });

    coreClient.on('chat.sources', ({ messageId, citations }) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, citations } : m)),
      }));
    });

    coreClient.on('models.pull', ({ completedBytes, totalBytes, done, error }) => {
      set({ pull: { active: !done, completedBytes, totalBytes, error } });
      if (done && !error) void get().refreshModelStatus();
    });

    void get().refreshThreads();
    void get().refreshModelStatus();
  },

  refreshThreads: async () => {
    try {
      const threads = await coreClient.listThreads();
      set({ threads });
    } catch {
      /* core unreachable — health toast already covers this */
    }
  },

  selectThread: async (id) => {
    set({ activeThreadId: id, messages: [], generationError: null });
    if (!id) return;
    const messages = await coreClient.getMessages(id);
    set((s) => (s.activeThreadId === id ? { messages } : s));
  },

  deleteThread: async (id) => {
    await coreClient.deleteThread(id);
    set((s) => ({
      threads: s.threads.filter((t) => t.id !== id),
      ...(s.activeThreadId === id ? { activeThreadId: null, messages: [] } : {}),
    }));
  },

  send: async (content) => {
    const { activeThreadId, persona } = get();
    set({ generationError: null });

    let threadId = activeThreadId;
    if (!threadId) {
      const thread = await coreClient.createThread();
      threadId = thread.id;
      set({ activeThreadId: threadId });
      void get().refreshThreads();
    }

    const now = new Date().toISOString();
    const { userMessageId, assistantMessageId } = await coreClient.sendMessage(
      threadId,
      content,
      persona,
    );
    set((s) => ({
      phase: 'thinking',
      streamingMessageId: assistantMessageId,
      messages: [
        ...s.messages,
        {
          id: userMessageId,
          threadId: threadId!,
          role: 'user',
          createdAt: now,
          segments: [{ segment: 'prose', content }],
        },
        {
          id: assistantMessageId,
          threadId: threadId!,
          role: 'assistant',
          persona,
          createdAt: now,
          segments: [],
        },
      ],
    }));
  },

  stop: async () => {
    const id = get().streamingMessageId;
    if (id) await coreClient.stopGeneration(id);
  },

  setPersona: (p) => set({ persona: p }),

  reveal: (messageId, level) =>
    set((s) => ({
      revealed: { ...s.revealed, [messageId]: Math.max(s.revealed[messageId] ?? 1, level) },
    })),

  refreshModelStatus: async () => {
    try {
      const modelStatus = await coreClient.modelStatus();
      set({ modelStatus });
    } catch {
      set({ modelStatus: null });
    }
  },

  startPull: async () => {
    set({ pull: { active: true, completedBytes: 0, totalBytes: 0 } });
    try {
      await coreClient.pullModel();
    } catch {
      set({ pull: { active: false, completedBytes: 0, totalBytes: 0, error: 'Pull failed to start.' } });
    }
  },
}));
