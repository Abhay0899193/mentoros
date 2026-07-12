/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { uniformIndices } from './videoFrames.js';

// Pure sampling math only — extractFrames needs a real <video>/canvas and is
// covered by the manual checklist (§10).

test('uniformIndices keeps every frame when pick = total', () => {
  assert.deepEqual(
    uniformIndices(5, 5),
    [0, 1, 2, 3, 4],
  );
  assert.equal(uniformIndices(121, 121).length, 121);
});

test('uniformIndices at half count skips alternate frames, keeping both ends', () => {
  const half = uniformIndices(100, 50);
  assert.equal(half.length, 50);
  assert.equal(half[0], 0);
  assert.equal(half[half.length - 1], 99);
  for (let i = 1; i < half.length; i += 1) {
    assert.ok(half[i]! > half[i - 1]!, 'strictly increasing (no duplicates)');
    assert.ok(half[i]! - half[i - 1]! <= 3, 'roughly every other frame');
  }
});

test('uniformIndices spreads a small pick across the whole video', () => {
  const q = uniformIndices(100, 25);
  assert.equal(q.length, 25);
  assert.equal(q[0], 0);
  assert.equal(q[q.length - 1], 99);
});

test('uniformIndices clamps and degenerates safely', () => {
  assert.deepEqual(uniformIndices(10, 99), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // pick > total
  assert.deepEqual(uniformIndices(10, 1), [0]);
  assert.deepEqual(uniformIndices(1, 5), [0]);
  assert.deepEqual(uniformIndices(0, 5), [0]); // guarded total
});
