import { create } from 'zustand';
import {
  coreClient,
  type DerivedProfile,
  type ImportSource,
  type MemoryGraphData,
  type MemoryRecord,
  type MemoryType,
} from './coreClient';
import { toast } from '../ui';

interface ImportState {
  source: ImportSource;
  step: string;
  created: number;
  merged: number;
  active: boolean;
  error?: string;
}

interface MemoryState {
  records: MemoryRecord[];
  profile: DerivedProfile | null;
  graph: MemoryGraphData | null;
  view: 'profile' | 'graph';
  query: string;
  selectedId: string | null;
  importState: ImportState | null;
  /** Live "context used" for the current chat generation (from chat.context). */
  liveContext: { id: string; type: MemoryType; title: string; score: number }[];

  init: () => void;
  refresh: () => Promise<void>;
  setView: (v: 'profile' | 'graph') => void;
  setQuery: (q: string) => void;
  select: (id: string | null) => void;
  save: (input: Parameters<typeof coreClient.saveMemory>[0]) => Promise<void>;
  update: (id: string, patch: Parameters<typeof coreClient.updateMemory>[1]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runImport: (source: ImportSource, path: string) => Promise<void>;
}

/** Canonical location of the 3-month-challenge repo (plan + notes + skill docs). */
export const THREE_MC_PATH = '/Users/singha7/Documents/abhay/3-month-challenge';

let initialized = false;

export const useMemories = create<MemoryState>((set, get) => ({
  records: [],
  profile: null,
  graph: null,
  view: 'profile',
  query: '',
  selectedId: null,
  importState: null,
  liveContext: [],

  init: () => {
    if (!initialized) {
      initialized = true;

      coreClient.on('memory.saved', ({ record, action, similarity }) => {
        toast({
          tone: 'success',
          title: action === 'merged' ? 'Memory updated' : 'Memory saved',
          description:
            action === 'merged'
              ? `“${record.title}” evolved (${Math.round((similarity ?? 0) * 100)}% match — no duplicate created).`
              : `“${record.title}” added to your ${record.type} memories.`,
        });
        void get().refresh();
      });

      coreClient.on('chat.context', ({ memories }) => set({ liveContext: memories }));

      coreClient.on('import.progress', ({ source, step, created, merged, done, error }) => {
        set({ importState: { source, step, created, merged, active: !done, error } });
        if (done && !error) {
          toast({
            tone: 'success',
            title: 'Import complete',
            description: `${created} new memories, ${merged} merged into existing ones.`,
          });
          void get().refresh();
        }
      });
    }
    void get().refresh();
  },

  refresh: async () => {
    try {
      const [records, profile, graph] = await Promise.all([
        coreClient.listMemories({ limit: 500 }),
        coreClient.profile(),
        coreClient.memoryGraph(),
      ]);
      set({ records, profile, graph });
    } catch {
      /* memory routes not up yet — screen shows its designed empty state */
    }
  },

  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),

  save: async (input) => {
    await coreClient.saveMemory(input); // memory.saved event refreshes + toasts
  },

  update: async (id, patch) => {
    const record = await coreClient.updateMemory(id, patch);
    set((s) => ({ records: s.records.map((r) => (r.id === id ? record : r)) }));
    void get().refresh();
  },

  remove: async (id) => {
    await coreClient.deleteMemory(id);
    set((s) => ({
      records: s.records.filter((r) => r.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    void get().refresh();
  },

  runImport: async (source, path) => {
    set({ importState: { source, step: 'Starting…', created: 0, merged: 0, active: true } });
    try {
      await coreClient.importSource(source, path);
    } catch {
      set({
        importState: {
          source,
          step: 'Import',
          created: 0,
          merged: 0,
          active: false,
          error: 'Import failed to start — is the core running?',
        },
      });
    }
  },
}));
