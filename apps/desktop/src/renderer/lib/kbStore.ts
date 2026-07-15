import { create } from 'zustand';
import {
  coreClient,
  CoreRequestError,
  type KbSearchHit,
  type KbSource,
  type KbSuggestedSource,
} from './coreClient';
import { toast, useToasts } from '../ui';

type IngestStep = 'reading' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'error';

/**
 * "New guide" run state (Phase G) — lives here, not component-local, so
 * closing GenerateGuideDialog mid-run and reopening it shows the current
 * state (generation keeps going in the background).
 */
export interface GuideRunState {
  status: 'idle' | 'generating' | 'ingesting' | 'done' | 'error';
  /** The submitted prompt — kept through the run so an error state can Retry it. */
  prompt?: string;
  chars?: number;
  sourceId?: string;
  slug?: string;
  error?: string;
}

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

  /** Collections nav selection (§Phase C) — shared by LibraryGrid + ReadingView's breadcrumb. */
  selectedCollectionId: string;

  addOpen: boolean;
  setAddOpen: (open: boolean) => void;

  /** "New guide" (Phase G) — see {@link GuideRunState}. */
  guideRun: GuideRunState;
  generateGuide: (prompt: string) => Promise<void>;
  resetGuideRun: () => void;

  init: () => void;
  refresh: () => Promise<void>;
  ingest: (path: string, opts?: { title?: string; tags?: string[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setQuery: (q: string) => void;
  runSearch: (q: string) => Promise<void>;
  openReading: (id: string, filePath?: string | null) => void;
  closeReading: () => void;
  setSelectedCollection: (id: string) => void;
  setRead: (id: string, read: boolean) => Promise<void>;
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

  selectedCollectionId: 'all',

  addOpen: false,
  setAddOpen: (addOpen) => set({ addOpen }),

  guideRun: { status: 'idle' },
  generateGuide: async (prompt) => {
    set({ guideRun: { status: 'generating', prompt, chars: 0 } });
    try {
      await coreClient.generateGuide(prompt);
      // Progress from here arrives over `guide.progress` (see init()).
    } catch (err) {
      const message =
        err instanceof CoreRequestError
          ? err.message
          : 'The knowledge base service did not respond.';
      set({ guideRun: { status: 'error', prompt, error: message } });
    }
  },
  resetGuideRun: () => set({ guideRun: { status: 'idle' } }),

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

      coreClient.on('guide.progress', (p) => {
        const prompt = get().guideRun.prompt;
        if (p.step === 'generating') {
          set({ guideRun: { status: 'generating', prompt, chars: p.chars } });
        } else if (p.step === 'ingesting') {
          set((s) => ({ guideRun: { status: 'ingesting', prompt, chars: s.guideRun.chars } }));
        } else if (p.step === 'done') {
          set({ guideRun: { status: 'done', prompt, slug: p.slug, sourceId: p.sourceId } });
          void get().refresh();
        } else {
          set({ guideRun: { status: 'error', prompt, error: p.error } });
        }
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
  setSelectedCollection: (selectedCollectionId) => set({ selectedCollectionId }),

  setRead: async (id, read) => {
    const prevSources = get().sources;
    const now = new Date().toISOString();
    set({
      sources: prevSources.map((s) => (s.id === id ? { ...s, readAt: read ? now : null } : s)),
    });
    try {
      const updated = await coreClient.setKbSourceRead(id, read);
      set((s) => ({ sources: s.sources.map((x) => (x.id === id ? updated : x)) }));
    } catch {
      set({ sources: prevSources });
      toast({
        tone: 'danger',
        title: read ? 'Could not mark as read' : 'Could not mark as unread',
        description: 'The knowledge base service did not respond.',
        action: { label: 'Retry', onClick: () => void get().setRead(id, read) },
      });
    }
  },
}));
