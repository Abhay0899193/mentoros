import type { KbSource } from '../../../lib/coreClient';

/** One navigable node in the Knowledge collections tree (§Phase C). */
export interface CollectionNode {
  id: string;
  label: string;
  /** Sources matching this node — de-duplicated even when children overlap. */
  sources: KbSource[];
  children?: CollectionNode[];
}

const AREA_LABELS: Record<string, string> = {
  dsa: 'DSA',
  os: 'OS',
  db: 'DB',
  oop: 'OOP',
  sql: 'SQL',
  api: 'API',
};

function titleCaseWords(s: string): string {
  const words = s.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelizeArea(area: string): string {
  return AREA_LABELS[area] ?? titleCaseWords(area);
}

function labelizeTopic(slug: string): string {
  return titleCaseWords(slug);
}

/** `week:N` tags on a source, parsed. A source may belong to more than one week. */
export function weekNumbers(tags: string[]): number[] {
  return tags
    .filter((t) => t.startsWith('week:'))
    .map((t) => Number.parseInt(t.slice('week:'.length), 10))
    .filter((n) => Number.isFinite(n));
}

/** `topic:area/slug` tag values (without the `topic:` prefix), e.g. `dsa/two-pointers`. */
export function topicValues(tags: string[]): string[] {
  return tags.filter((t) => t.startsWith('topic:')).map((t) => t.slice('topic:'.length));
}

/** `part:N` tag, parsed — null when the source isn't part of a multi-part guide. */
export function partNumber(tags: string[]): number | null {
  const tag = tags.find((t) => t.startsWith('part:'));
  if (!tag) return null;
  const n = Number.parseInt(tag.slice('part:'.length), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Study-flow order: week asc → part asc → title. Sources without week/part
 * tags sink below tagged ones, alphabetically — so guides read as a course
 * (Week 1 part 0…N, Week 2 …) instead of import order.
 */
export function sourceFlowCompare(a: KbSource, b: KbSource): number {
  const aWeeks = weekNumbers(a.tags);
  const bWeeks = weekNumbers(b.tags);
  const aWeek = aWeeks.length > 0 ? Math.min(...aWeeks) : Number.POSITIVE_INFINITY;
  const bWeek = bWeeks.length > 0 ? Math.min(...bWeeks) : Number.POSITIVE_INFINITY;
  if (aWeek !== bWeek) return aWeek - bWeek;
  const aPart = partNumber(a.tags) ?? Number.POSITIVE_INFINITY;
  const bPart = partNumber(b.tags) ?? Number.POSITIVE_INFINITY;
  if (aPart !== bPart) return aPart - bPart;
  return a.title.localeCompare(b.title);
}

function flowSorted(sources: KbSource[]): KbSource[] {
  return [...sources].sort(sourceFlowCompare);
}

function dedupeById(sources: KbSource[]): KbSource[] {
  const seen = new Set<string>();
  const out: KbSource[] = [];
  for (const s of sources) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Builds the collections tree from the flat sources list — no extra fetches,
 * everything is derived from tags already on `KbSource` (§Phase C spec).
 * The same source can appear under more than one node (its week AND its
 * topic) — that's intended.
 */
export function buildCollections(sources: KbSource[]): CollectionNode[] {
  // Weekly guides: study-guide sources, grouped by every week: tag they carry.
  const weekMap = new Map<number, KbSource[]>();
  for (const s of sources) {
    if (!s.tags.includes('study-guide')) continue;
    for (const week of weekNumbers(s.tags)) {
      const arr = weekMap.get(week) ?? [];
      arr.push(s);
      weekMap.set(week, arr);
    }
  }
  const weekNodes: CollectionNode[] = [...weekMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, srcs]) => ({ id: `week:${week}`, label: `Week ${week}`, sources: flowSorted(srcs) }));

  // Topics: any origin, grouped by the tag's area prefix (`dsa/two-pointers` → DSA).
  const topicMap = new Map<string, KbSource[]>();
  for (const s of sources) {
    for (const topic of topicValues(s.tags)) {
      const arr = topicMap.get(topic) ?? [];
      arr.push(s);
      topicMap.set(topic, arr);
    }
  }
  const areaChildren = new Map<string, CollectionNode[]>();
  for (const [topic, srcs] of topicMap) {
    const slashIdx = topic.indexOf('/');
    const area = slashIdx === -1 ? topic : topic.slice(0, slashIdx);
    const slug = slashIdx === -1 ? topic : topic.slice(slashIdx + 1);
    const children = areaChildren.get(area) ?? [];
    children.push({ id: `topic:${topic}`, label: labelizeTopic(slug), sources: flowSorted(srcs) });
    areaChildren.set(area, children);
  }
  const topicNodes: CollectionNode[] = [...areaChildren.entries()]
    .map(([area, children]) => {
      const sortedChildren = [...children].sort((a, b) => a.label.localeCompare(b.label));
      return {
        id: `topics:${area}`,
        label: labelizeArea(area),
        sources: flowSorted(dedupeById(sortedChildren.flatMap((c) => c.sources))),
        children: sortedChildren,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const skillSheets = flowSorted(sources.filter((s) => s.tags.includes('quick-review')));
  // In-app "New guide" output (Phase G) — STUDY-GUIDES/custom/**, tagged `generated`
  // by the importer. Also reachable under Topics (it still carries topic: tags).
  const generated = flowSorted(sources.filter((s) => s.tags.includes('generated')));
  const other = flowSorted(sources.filter((s) => !s.tags.includes('3mc')));

  return [
    { id: 'all', label: 'All', sources: flowSorted(sources) },
    {
      id: 'weekly',
      label: 'Weekly guides',
      sources: flowSorted(dedupeById(weekNodes.flatMap((n) => n.sources))),
      children: weekNodes,
    },
    {
      id: 'topics',
      label: 'Topics',
      sources: flowSorted(dedupeById(topicNodes.flatMap((n) => n.sources))),
      children: topicNodes,
    },
    { id: 'skill-sheets', label: 'Skill sheets', sources: skillSheets },
    { id: 'generated', label: 'Generated', sources: generated },
    { id: 'other', label: 'Other', sources: other },
  ];
}

/** Depth-first lookup by node id — collections trees are shallow (2 levels). */
export function findCollection(tree: CollectionNode[], id: string): CollectionNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findCollection(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function unreadCount(node: CollectionNode): number {
  return node.sources.reduce((n, s) => n + (s.readAt === null ? 1 : 0), 0);
}
