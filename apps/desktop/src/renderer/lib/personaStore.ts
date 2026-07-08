import { create } from 'zustand';
import {
  coreClient,
  CoreRequestError,
  type Persona,
  type PersonaDraft,
  type PersonaDraftRequest,
  type PersonaInput,
  type PersonaRecord,
} from './coreClient';
import { toast } from '../ui';

const SERVICE_ERROR = 'The persona service did not respond.';

interface PersonaState {
  personas: PersonaRecord[];
  personasLoading: boolean;
  personasLoaded: boolean;
  personasError: string | null;

  /** Set while create/update is in flight — only one editor can be open at once. */
  saving: boolean;
  saveError: string | null;

  /** Set while a "Draft it for me" generation is in flight. */
  drafting: boolean;
  draftError: string | null;

  init: () => void;
  loadPersonas: () => Promise<void>;
  clearSaveError: () => void;
  clearDraftError: () => void;
  create: (input: PersonaInput) => Promise<PersonaRecord | null>;
  update: (id: Persona, patch: Partial<PersonaInput>) => Promise<PersonaRecord | null>;
  remove: (id: Persona) => Promise<void>;
  draft: (req: PersonaDraftRequest) => Promise<PersonaDraft | null>;
}

let initialized = false;

export const usePersonas = create<PersonaState>((set, get) => ({
  personas: [],
  personasLoading: false,
  personasLoaded: false,
  personasError: null,

  saving: false,
  saveError: null,

  drafting: false,
  draftError: null,

  init: () => {
    if (!initialized) {
      initialized = true;
      coreClient.on('personas.changed', ({ personas }) => set({ personas, personasLoaded: true }));
    }
    void get().loadPersonas();
  },

  loadPersonas: async () => {
    set({ personasLoading: !get().personasLoaded, personasError: null });
    try {
      const personas = await coreClient.listPersonas();
      set({ personas, personasLoading: false, personasLoaded: true });
    } catch {
      set({ personasLoading: false, personasLoaded: true, personasError: SERVICE_ERROR });
    }
  },

  clearSaveError: () => set({ saveError: null }),
  clearDraftError: () => set({ draftError: null }),

  create: async (input) => {
    set({ saving: true, saveError: null });
    try {
      const record = await coreClient.createPersona(input);
      // The personas.changed broadcast can land before this response resolves —
      // replace by id if the record is already in the list instead of appending.
      set((s) => ({
        saving: false,
        personas: s.personas.some((p) => p.id === record.id)
          ? s.personas.map((p) => (p.id === record.id ? record : p))
          : [...s.personas, record],
      }));
      toast({ tone: 'success', title: 'Persona created', description: record.name });
      return record;
    } catch (err) {
      set({
        saving: false,
        saveError: err instanceof CoreRequestError ? err.message : SERVICE_ERROR,
      });
      return null;
    }
  },

  update: async (id, patch) => {
    set({ saving: true, saveError: null });
    try {
      const record = await coreClient.updatePersona(id, patch);
      set((s) => ({
        saving: false,
        personas: s.personas.map((p) => (p.id === id ? record : p)),
      }));
      toast({ tone: 'success', title: 'Persona updated', description: record.name });
      return record;
    } catch (err) {
      set({
        saving: false,
        saveError: err instanceof CoreRequestError ? err.message : SERVICE_ERROR,
      });
      return null;
    }
  },

  remove: async (id) => {
    const prev = get().personas;
    const removed = prev.find((p) => p.id === id);
    set({ personas: prev.filter((p) => p.id !== id) });
    try {
      await coreClient.deletePersona(id);
      toast({
        tone: 'success',
        title: 'Persona deleted',
        description: removed ? removed.name : undefined,
      });
    } catch {
      set({ personas: prev });
      toast({
        tone: 'danger',
        title: 'Could not delete this persona',
        description: SERVICE_ERROR,
        action: { label: 'Retry', onClick: () => void get().remove(id) },
      });
    }
  },

  draft: async (req) => {
    set({ drafting: true, draftError: null });
    try {
      const draft = await coreClient.draftPersona(req);
      set({ drafting: false });
      return draft;
    } catch (err) {
      set({
        drafting: false,
        draftError: err instanceof CoreRequestError ? err.message : SERVICE_ERROR,
      });
      return null;
    }
  },
}));
