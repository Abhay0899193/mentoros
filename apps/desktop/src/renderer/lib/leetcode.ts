/**
 * LeetCode titleSlug extraction — renderer mirror of
 * core/interview/leetcode.ts `slugFromLeetCodeUrl` (the coreClient boundary
 * rule keeps core imports out of screens; keep the two in sync).
 *   https://leetcode.com/problems/two-sum/             → "two-sum"
 *   https://leetcode.com/problems/two-sum/description/ → "two-sum"
 *   https://www.leetcode.com/problems/two-sum?tab=x    → "two-sum"
 * Anything that is not a leetcode.com/.cn /problems/ URL → null.
 */
export function slugFromLeetCodeUrl(url: string | undefined | null): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'leetcode.com' && host !== 'leetcode.cn') return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const idx = segments.indexOf('problems');
  if (idx === -1) return null;
  const slug = segments[idx + 1];
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return slug;
}

/** Canonical problem URL for a titleSlug — the "Open on LeetCode" anchor. */
export function leetCodeUrlForSlug(slug: string): string {
  return `https://leetcode.com/problems/${slug}/`;
}
