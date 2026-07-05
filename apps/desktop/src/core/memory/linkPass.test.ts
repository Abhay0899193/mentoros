import assert from "node:assert/strict";
import test from "node:test";
import { computeLinks, type LinkableRecord } from "./linkPass.js";

function rec(id: string, title: string, body: string, links: string[] = []): LinkableRecord {
  return { id, title, body, links };
}

test("computeLinks links a title-concept referenced in another body (bidirectional)", () => {
  const records = [
    rec("m1", "Sliding Window", "confidence 4/5 notes on the technique"),
    rec("m2", "Review: Longest Substring", "solved using a sliding window over the string"),
  ];
  const changed = computeLinks(records);
  assert.deepEqual(changed.get("m1"), ["m2"]);
  assert.deepEqual(changed.get("m2"), ["m1"]);
});

test("computeLinks ignores titles with fewer than 2 significant tokens", () => {
  const records = [
    rec("m1", "Graphs", "a graphs body"),
    rec("m2", "Note", "this mentions graphs and a graph"),
  ];
  const changed = computeLinks(records);
  // "Graphs" is a single significant token → not a linking source.
  assert.equal(changed.size, 0);
});

test("computeLinks requires ALL significant title tokens present in the body", () => {
  const records = [
    rec("m1", "Complexity Miscalculation", "root cause analysis"),
    rec("m2", "Note", "a body about complexity only"),
  ];
  const changed = computeLinks(records);
  assert.equal(changed.size, 0); // "miscalculation" absent
});

test("computeLinks is additive + idempotent on already-linked records", () => {
  const records = [
    rec("m1", "Sliding Window", "the technique", ["m2"]),
    rec("m2", "Review: Foo", "uses a sliding window", ["m1"]),
  ];
  const changed = computeLinks(records);
  assert.equal(changed.size, 0); // no new edges, nothing changes
});

test("computeLinks caps links per record at 5", () => {
  const hub = rec("hub", "Two Pointers", "the two pointers idea");
  const others: LinkableRecord[] = [];
  for (let i = 0; i < 8; i += 1) {
    others.push(rec(`o${i}`, `Problem ${i}`, "solved with two pointers technique"));
  }
  const changed = computeLinks([hub, ...others]);
  assert.equal(changed.get("hub")!.length, 5);
});
