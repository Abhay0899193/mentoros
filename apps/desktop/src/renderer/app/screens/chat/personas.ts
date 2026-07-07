import type { Persona, PersonaRecord, PersonaStyle } from '../../../lib/coreClient';

export type PersonaTone = 'iris' | 'warning' | 'success' | 'info';

export interface PersonaMeta {
  id: Persona;
  label: string;
  /** Status-tone accent (allowed color use: persona is state, not chrome). */
  tone: PersonaTone;
  tagline: string;
}

/**
 * Static fallback — the 4 built-ins, shown before `listPersonas()` resolves
 * (never a blank picker) and used as the last-resort lookup for a stale/
 * deleted persona id.
 */
export const PERSONAS: PersonaMeta[] = [
  { id: 'staff-engineer', label: 'Staff Engineer', tone: 'iris', tagline: 'Pragmatic, tradeoff-driven, production-minded.' },
  { id: 'interviewer', label: 'Interviewer', tone: 'warning', tagline: 'Probing questions, no free answers.' },
  { id: 'teacher', label: 'Teacher', tone: 'success', tagline: 'Patient, first-principles, checks understanding.' },
  { id: 'architect', label: 'Architect', tone: 'info', tagline: 'Systems view, constraints first, diagrams in prose.' },
];

const BUILTIN_TONE: Partial<Record<Persona, PersonaTone>> = {
  'staff-engineer': 'iris',
  interviewer: 'warning',
  teacher: 'success',
  architect: 'info',
};

/** Custom personas have no fixed tone — derive one from their coaching stance. */
const STYLE_TONE: Record<PersonaStyle, PersonaTone> = {
  strict: 'warning',
  balanced: 'iris',
  supportive: 'success',
};

export const personaMeta = (id: Persona): PersonaMeta =>
  PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];

function metaFromRecord(record: PersonaRecord): PersonaMeta {
  return {
    id: record.id,
    label: record.name,
    tone: BUILTIN_TONE[record.id] ?? STYLE_TONE[record.style],
    tagline: record.tagline,
  };
}

/**
 * Single lookup used by every persona chip/picker: prefers the live
 * `listPersonas()` record (so custom names/taglines show up immediately),
 * falls back to the static built-in copy while the list is still loading or
 * for a persona id that no longer exists (deleted custom — never blank).
 */
export function resolvePersonaMeta(id: Persona, personas: PersonaRecord[]): PersonaMeta {
  const record = personas.find((p) => p.id === id);
  return record ? metaFromRecord(record) : personaMeta(id);
}
