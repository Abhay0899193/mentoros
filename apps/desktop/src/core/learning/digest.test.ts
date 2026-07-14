import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSourceDigest } from "./digest.js";

const PLAN = JSON.stringify([{ phase: 1, weeks: [] }]);

async function make3mcTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "digest-test-"));
  await mkdir(join(root, "study-ui/data"), { recursive: true });
  await writeFile(join(root, "study-ui/data/parsed-plan.json"), PLAN);
  // Per-day markdown under PHASE-*/week-*/day-*.md
  await mkdir(join(root, "PHASE-1/week-01"), { recursive: true });
  await writeFile(join(root, "PHASE-1/week-01/day-01.md"), "# Day 1");
  // Flat quick-review sheet
  await mkdir(join(root, "SKILLS-TRACK"), { recursive: true });
  await writeFile(join(root, "SKILLS-TRACK/docker.md"), "# Docker");
  // Recursive study guide (subfolder)
  await mkdir(join(root, "STUDY-GUIDES/phase-1"), { recursive: true });
  await writeFile(join(root, "STUDY-GUIDES/phase-1/week-01.md"), "# Guide");
  return root;
}

test("computeSourceDigest returns a stable hash for an unchanged tree", async () => {
  const root = await make3mcTree();
  const a = computeSourceDigest(root);
  const b = computeSourceDigest(root);
  assert.equal(typeof a, "string");
  assert.equal(a, b);
});

test("computeSourceDigest changes when a covered file is touched", async () => {
  const root = await make3mcTree();
  const before = computeSourceDigest(root);
  const future = new Date(Date.now() + 60_000);
  await utimes(join(root, "PHASE-1/week-01/day-01.md"), future, future);
  const after = computeSourceDigest(root);
  assert.notEqual(before, after);
});

test("computeSourceDigest changes when a covered file is added", async () => {
  const root = await make3mcTree();
  const before = computeSourceDigest(root);
  await writeFile(join(root, "SKILLS-TRACK/redis.md"), "# Redis");
  const after = computeSourceDigest(root);
  assert.notEqual(before, after);
});

test("computeSourceDigest changes when a nested guide is added", async () => {
  const root = await make3mcTree();
  const before = computeSourceDigest(root);
  await mkdir(join(root, "STUDY-GUIDES/phase-2"), { recursive: true });
  await writeFile(join(root, "STUDY-GUIDES/phase-2/week-05.md"), "# Deep");
  const after = computeSourceDigest(root);
  assert.notEqual(before, after);
});

test("computeSourceDigest changes when a covered file is removed", async () => {
  const root = await make3mcTree();
  const before = computeSourceDigest(root);
  await rm(join(root, "SKILLS-TRACK/docker.md"));
  const after = computeSourceDigest(root);
  assert.notEqual(before, after);
});

test("computeSourceDigest returns null when the root is missing", () => {
  assert.equal(computeSourceDigest(join(tmpdir(), "does-not-exist-xyz")), null);
});

test("computeSourceDigest returns null when the plan file is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "digest-noplan-"));
  await mkdir(join(root, "SKILLS-TRACK"), { recursive: true });
  await writeFile(join(root, "SKILLS-TRACK/docker.md"), "# Docker");
  assert.equal(computeSourceDigest(root), null);
});
