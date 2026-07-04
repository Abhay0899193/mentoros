import type { Persona } from '../../../lib/coreClient';

export interface PersonaMeta {
  id: Persona;
  label: string;
  /** Status-tone accent (allowed color use: persona is state, not chrome). */
  tone: 'iris' | 'warning' | 'success' | 'info';
  tagline: string;
}

export const PERSONAS: PersonaMeta[] = [
  { id: 'staff-engineer', label: 'Staff Engineer', tone: 'iris', tagline: 'Pragmatic, tradeoff-driven, production-minded.' },
  { id: 'interviewer', label: 'Interviewer', tone: 'warning', tagline: 'Probing questions, no free answers.' },
  { id: 'teacher', label: 'Teacher', tone: 'success', tagline: 'Patient, first-principles, checks understanding.' },
  { id: 'architect', label: 'Architect', tone: 'info', tagline: 'Systems view, constraints first, diagrams in prose.' },
];

export const personaMeta = (id: Persona): PersonaMeta =>
  PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
