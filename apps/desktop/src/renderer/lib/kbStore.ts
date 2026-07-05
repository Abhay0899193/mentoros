import { create } from 'zustand';
import {
  coreClient,
  type KbSearchHit,
  type KbSource,
  type KbSuggestedSource,
} from './coreClient';
import { toast, useToasts } from '../ui';

type IngestStep = 'reading' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'error';

interface IngestProgress {
  path: string;
  sourceId?: string;
  step: IngestStep;
  fileIndex?: number;
  fileCount?: number;
  chunksDone: number;
  chunksTotal: number;
  done: boolean;
  error?: string;
  title?: string;
  tags?: string[];
}

interface KbState {
  sources: KbSource[];
  suggestions: KbSuggestedSource[];
  loading: boolean;
  loaded: boolean;
  ingests: Record<string, IngestProgress>;

  query: string;
  results: KbSearchHit[];
  searching: boolean;
  searched: boolean;
  searchError: string | null;

  readingId: string | null;
  readingFile: string | null;

  addOpen: boolean;
  setAddOpen: (open: boolean) => void;

  init: () => void;
  refresh: () => Promise<void>;
  ingest: (path: string, opts?: { title?: string; tags?: string[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setQuery: (q: string) => void;
  runSearch: (q: string) => Promise<void>;
  openReading: (id: string, filePath?: string | null) => void;
  closeReading: () => void;
}

let initialized = false;
const toastIdByPath: Record<string, number> = {};
let searchSeq = 0;

const STEP_LABEL: Record<IngestStep, string> = {
  reading: 'Reading',
  chunking: 'Chunking',
  embedding: 'Embedding',
  indexing: 'Indexing',
  done: 'Indexed',
  error: 'Failed',
};

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function lastToastId(): number | undefined {
  const toasts = useToasts.getState().toasts;
  return toasts[toasts.length - 1]?.id;
}

/** One toast per source path, replaced as `kb.ingest` steps arrive (§4.7). */
function pushIngestToast(p: IngestProgress) {
  const prevId = toastIdByPath[p.path];
  if (prevId !== undefined) useToasts.getState().dismiss(prevId);

  const name = p.title ?? fileName(p.path);
  const description =
    p.step === 'error'
      ? (p.error ?? 'Something went wrong while indexing this source.')
      : p.chunksTotal > 0
        ? `${STEP_LABEL[p.step]} · ${p.chunksDone}/${p.chunksTotal} chunks`
        : `${STEP_LABEL[p.step]}…`;

  toast({
    tone: p.step === 'error' ? 'danger' : p.done ? 'success' : 'info',
    title:
      p.step === 'error' ? `Couldn't index "${name}"` : p.done ? `Indexed "${name}"` : `Indexing "${name}"`,
    description,
    action:
      p.step === 'error'
        ? { label: 'Retry', onClick: () => void useKb.getState().ingest(p.path, { title: p.title, tags: p.tags }) }
        : undefined,
  });

  const id = lastToastId();
  if (id !== undefined) toastIdByPath[p.path] = id;
}

export const useKb = create<KbState>((set, get) => ({
  sources: [],
  suggestions: [],
  loading: false,
  loaded: false,
  ingests: {},

  query: '',
  results: [],
  searching: false,
  searched: false,
  searchError: null,

  readingId: null,
  readingFile: null,

  addOpen: false,
  setAddOpen: (addOpen) => set({ addOpen }),

  init: () => {
    if (!initialized) {
      initialized = true;

      coreClient.on('kb.updated', ({ sources }) => set({ sources }));

      coreClient.on('kb.ingest', (p) => {
        set((s) => ({
          ingests: { ...s.ingests, [p.path]: { ...s.ingests[p.path], ...p } },
        }));
        pushIngestToast(get().ingests[p.path]);
        if (p.done && !p.error) void get().refresh();
      });
    }
    void get().refresh();
  },

  refresh: async () => {
    set({ loading: !get().loaded });
    try {
      const [sources, suggestions] = await Promise.all([
        coreClient.listKbSources(),
        coreClient.kbSuggestions(),
      ]);
      set({ sources, suggestions, loading: false, loaded: true });
    } catch {
      set({ loading: false, loaded: true });
      /* kb routes not up yet — screen shows its designed empty state */
    }
  },

  ingest: async (path, opts) => {
    const progress: IngestProgress = {
      path,
      step: 'reading',
      chunksDone: 0,
      chunksTotal: 0,
      done: false,
      title: opts?.title,
      tags: opts?.tags,
    };
    set((s) => ({ ingests: { ...s.ingests, [path]: progress } }));
    pushIngestToast(progress);
    try {
      const { sourceId } = await coreClient.ingestKbSource(path, opts);
      set((s) => ({ ingests: { ...s.ingests, [path]: { ...s.ingests[path], sourceId } } }));
    } catch {
      const failed: IngestProgress = {
        ...progress,
        step: 'error',
        done: true,
        error: 'The knowledge base service did not respond.',
      };
      set((s) => ({ ingests: { ...s.ingests, [path]: failed } }));
      pushIngestToast(failed);
    }
  },

  remove: async (id) => {
    const prevSources = get().sources;
    set({ sources: prevSources.filter((s) => s.id !== id) });
    try {
      await coreClient.deleteKbSource(id);
    } catch {
      set({ sources: prevSources });
      toast({
        tone: 'danger',
        title: 'Could not remove source',
        description: 'The knowledge base service did not respond.',
        action: { label: 'Retry', onClick: () => void get().remove(id) },
      });
    }
  },

  setQuery: (query) => set({ query }),

  runSearch: async (q) => {
    const seq = ++searchSeq;
    const trimmed = q.trim();
    if (trimmed === '') {
      set({ results: [], searching: false, searched: false, searchError: null });
      return;
    }
    set({ searching: true, searchError: null });
    try {
      const results = await coreClient.hybridSearch(trimmed);
      if (seq === searchSeq) set({ results, searching: false, searched: true });
    } catch {
      if (seq === searchSeq) {
        set({
          results: [],
          searching: false,
          searched: true,
          searchError: 'The knowledge base service did not respond.',
        });
      }
    }
  },

  openReading: (id, filePath = null) => set({ readingId: id, readingFile: filePath }),
  closeReading: () => set({ readingId: null, readingFile: null }),
}));
