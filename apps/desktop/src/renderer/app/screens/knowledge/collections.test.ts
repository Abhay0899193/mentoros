import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollections, findCollection, sourceFlowCompare } from './collections';
import type { KbSource } from '../../../lib/coreClient';

let nextId = 0;
function src(title: string, tags: string[]): KbSource {
  return {
    id: `s${nextId++}`,
    kind: 'md',
    title,
    path: `/tmp/${title}.md`,
    chunkCount: 1,
    fileCount: 1,
    indexedAt: '2026-07-14T00:00:00Z',
    tags,
    readAt: null,
  };
}

test('sourceFlowCompare orders week asc, then part asc, then title', () => {
  const w2p1 = src('B', ['3mc', 'study-guide', 'week:2', 'part:1']);
  const w1p2 = src('C', ['3mc', 'study-guide', 'week:1', 'part:2']);
  const w1p0 = src('A', ['3mc', 'study-guide', 'week:1', 'part:0']);
  const untagged = src('Z-untagged', []);
  const sorted = [untagged, w2p1, w1p2, w1p0].sort(sourceFlowCompare);
  assert.deepEqual(
    sorted.map((s) => s.title),
    ['A', 'C', 'B', 'Z-untagged'],
  );
});

test('buildCollections nodes come back in flow order, not import order', () => {
  const w1p1 = src('Two pointers', ['3mc', 'study-guide', 'week:1', 'part:1']);
  const w1p0 = src('Week 1 overview', ['3mc', 'study-guide', 'week:1', 'part:0']);
  const w2p0 = src('Week 2 overview', ['3mc', 'study-guide', 'week:2', 'part:0']);
  // deliberately shuffled input
  const tree = buildCollections([w2p0, w1p1, w1p0]);

  const all = findCollection(tree, 'all')!;
  assert.deepEqual(
    all.sources.map((s) => s.title),
    ['Week 1 overview', 'Two pointers', 'Week 2 overview'],
  );

  const week1 = findCollection(tree, 'week:1')!;
  assert.deepEqual(
    week1.sources.map((s) => s.title),
    ['Week 1 overview', 'Two pointers'],
  );

  const weekly = findCollection(tree, 'weekly')!;
  assert.equal(weekly.sources[0].title, 'Week 1 overview');
  assert.equal(weekly.sources.at(-1)!.title, 'Week 2 overview');
});

test('buildCollections places a Generated node (tag `generated`) after Skill sheets, before Other', () => {
  const skillSheet = src('Docker', ['3mc', 'quick-review', 'week:1']);
  const guide = src('Week 1 overview', ['3mc', 'study-guide', 'week:1', 'part:0']);
  const generated = src('Bit Manipulation Tricks', ['3mc', 'study-guide', 'topic:dsa/bit-manipulation', 'generated']);
  const other = src('Random note', []);
  const tree = buildCollections([skillSheet, guide, generated, other]);

  const ids = tree.map((n) => n.id);
  assert.ok(ids.indexOf('generated') > ids.indexOf('skill-sheets'));
  assert.ok(ids.indexOf('generated') < ids.indexOf('other'));

  const generatedNode = findCollection(tree, 'generated')!;
  assert.deepEqual(generatedNode.sources.map((s) => s.title), ['Bit Manipulation Tricks']);

  // A generated doc's topic tags still surface it under Topics too (intended overlap).
  const dsaTopics = findCollection(tree, 'topics:dsa')!;
  assert.ok(dsaTopics.sources.some((s) => s.title === 'Bit Manipulation Tricks'));

  // Untagged sources still land in Other, not Generated.
  const otherNode = findCollection(tree, 'other')!;
  assert.deepEqual(otherNode.sources.map((s) => s.title), ['Random note']);
});
