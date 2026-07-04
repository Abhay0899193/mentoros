/**
 * Seed profile (plan.md Part 9) — realistic data for every screen.
 * Never lorem ipsum. Replaced by real Memory records in Phase 2.
 */
export const profile = {
  name: 'Abhay',
  role: 'SDE3 · backend-leaning',
  goal: 'Reach Staff Engineer',
  stack: ['AWS', 'Node', 'React', 'DynamoDB', 'Datadog'],
  strengths: ['System Design', 'Backend', 'Leadership'],
  weaknesses: ['Graphs', 'Dynamic Programming', 'Networking'],
  reading: { title: 'Designing Data-Intensive Applications', percent: 70 },
  interviews: { total: 132, sql: 92, architecture: 84, behavioral: 95 },
  career: { systemDesign: 84, leadership: 90, dsa: 68, communication: 88 },
} as const;

export interface RecalledMemory {
  id: string;
  type: 'goal' | 'skill' | 'learning' | 'identity';
  title: string;
  detail: string;
  confidence: number; // 0..1
}

/** What the mentor is "using now" — shown in the right context panel. */
export const recalledMemories: RecalledMemory[] = [
  {
    id: 'goal-staff',
    type: 'goal',
    title: 'Goal: Staff Engineer',
    detail: 'Primary career target; drives mission selection.',
    confidence: 0.98,
  },
  {
    id: 'skill-weak-graphs',
    type: 'skill',
    title: 'Weakness: Graphs, DP',
    detail: 'Recurring gap across 132 interviews — drill scheduled.',
    confidence: 0.91,
  },
  {
    id: 'learning-ddia',
    type: 'learning',
    title: 'Reading: DDIA — 70%',
    detail: 'Ch. 7 (Transactions) in progress.',
    confidence: 0.85,
  },
];

export const personas = ['Staff Engineer', 'Interviewer', 'Teacher', 'Architect'] as const;

export const missions = [
  'One SQL optimization question',
  'One system-design review (URL shortener scaling)',
  'One architecture review',
  'One AWS question (DynamoDB Streams)',
  'One code review',
] as const;
