import type { BankProblem } from "./problems.js";

/**
 * Weakness-targeted problem recommendation (§4.5). Reads the candidate's
 * recurring-mistake / weakness memories, maps their themes to bank patterns, and
 * picks the highest-scoring UNSOLVED problem so the launcher can nudge the exact
 * gap the profile exposes. Falls back to the easiest unsolved problem when there
 * is no mistake signal yet.
 */

const DIFFICULTY_RANK: Record<BankProblem["difficulty"], number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

/** theme keyword(s) → the bank patterns that drill that weakness. */
const THEME_MAP: { keywords: RegExp; patterns: string[] }[] = [
  { keywords: /complexity|big-?o|time limit|tle|too slow|inefficient/i, patterns: ["dp-1d", "two-pointers", "sliding-window"] },
  { keywords: /off-?by-?one|boundary|index error|out of bounds/i, patterns: ["binary-search", "sliding-window"] },
  { keywords: /edge case|empty|null|corner case/i, patterns: ["intervals", "stack"] },
  { keywords: /optimi[sz]ation|missed optimization|brute force|suboptimal/i, patterns: ["greedy", "sliding-window", "dp-1d"] },
  { keywords: /recursion|stack overflow|traversal|graph/i, patterns: ["graphs"] },
  { keywords: /hash|lookup|duplicate/i, patterns: ["arrays-and-hashing"] },
  { keywords: /pointer|window/i, patterns: ["two-pointers"] },
];

export interface MistakeSignal {
  title: string;
  body: string;
  count: number;
}

export interface RecResult {
  id: string;
  reason: string;
}

/** Pick a recommended problem, or null when nothing sensible is unsolved. */
export function recommendProblem(
  problems: BankProblem[],
  mistakes: MistakeSignal[],
  solvedIds: Set<string>,
): RecResult | null {
  const unsolved = problems.filter((p) => !solvedIds.has(p.id));
  if (unsolved.length === 0) return null;

  // Accumulate weakness weight per pattern, remembering the driving mistake.
  const patternScore = new Map<string, { score: number; driver: MistakeSignal }>();
  for (const m of mistakes) {
    const text = `${m.title} ${m.body}`;
    for (const theme of THEME_MAP) {
      if (!theme.keywords.test(text)) continue;
      for (const pattern of theme.patterns) {
        const cur = patternScore.get(pattern);
        if (!cur || m.count > cur.driver.count) {
          patternScore.set(pattern, { score: (cur?.score ?? 0) + m.count, driver: m });
        } else {
          cur.score += m.count;
        }
      }
    }
  }

  let best: { problem: BankProblem; score: number; driver: MistakeSignal } | null = null;
  for (const p of unsolved) {
    const hit = patternScore.get(p.pattern);
    if (!hit || hit.score <= 0) continue;
    if (!best || hit.score > best.score) {
      best = { problem: p, score: hit.score, driver: hit.driver };
    }
  }

  if (best) {
    const label = best.driver.title.trim() || "a recurring mistake";
    const countSuffix = best.driver.count > 1 ? ` ×${best.driver.count}` : "";
    return { id: best.problem.id, reason: `targets: ${label}${countSuffix}` };
  }

  // Fallback: the easiest unsolved problem (stable bank order within a tier).
  const easiest = [...unsolved].sort(
    (a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty],
  )[0];
  return { id: easiest.id, reason: "a fresh problem to build momentum" };
}
