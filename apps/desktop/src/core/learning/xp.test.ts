import assert from "node:assert/strict";
import test from "node:test";
import {
  costToNext,
  LEVEL_CAP,
  levelForXp,
  perfectDayBonus,
  streakMilestoneBonus,
  weekCompleteBonus,
  weeklyXpBuckets,
  xpForDocRead,
  xpForMissionItem,
  xpForTask,
  xpOnDay,
  type XpEvent,
} from "./xp.js";

/* -------------------------------- task XP -------------------------------- */

test("xpForTask: leetcode by difficulty", () => {
  assert.equal(xpForTask({ kind: "leetcode", difficulty: "Easy" }), 50);
  assert.equal(xpForTask({ kind: "leetcode", difficulty: "Medium" }), 150);
  assert.equal(xpForTask({ kind: "leetcode", difficulty: "Hard" }), 300);
  assert.equal(xpForTask({ kind: "leetcode" }), 50); // unlabelled
});

test("xpForTask: review 75, reading/video family 75, hands-on 100, else 50", () => {
  assert.equal(xpForTask({ kind: "review" }), 75);
  assert.equal(xpForTask({ kind: "video" }), 75);
  assert.equal(xpForTask({ kind: "article" }), 75);
  assert.equal(xpForTask({ kind: "docs" }), 75);
  assert.equal(xpForTask({ kind: "book" }), 75);
  assert.equal(xpForTask({ kind: "course" }), 75);
  assert.equal(xpForTask({ kind: "hands-on" }), 100);
  assert.equal(xpForTask({ kind: "other" }), 50);
});

/* ------------------------------ doc-read XP ------------------------------ */

test("xpForDocRead: study-guide 75, quick-review 40, else 0", () => {
  assert.equal(xpForDocRead(["3mc", "study-guide", "part:2"]), 75);
  assert.equal(xpForDocRead(["3mc", "quick-review", "week:5"]), 40);
  assert.equal(xpForDocRead(["3mc", "week:1"]), 0);
  assert.equal(xpForDocRead([]), 0);
  // study-guide wins if both are present.
  assert.equal(xpForDocRead(["quick-review", "study-guide"]), 75);
});

/* -------------------------------- bonuses -------------------------------- */

test("perfectDayBonus / weekCompleteBonus scale linearly, floor at 0", () => {
  assert.equal(perfectDayBonus(0), 0);
  assert.equal(perfectDayBonus(3), 150);
  assert.equal(perfectDayBonus(-2), 0);
  assert.equal(weekCompleteBonus(0), 0);
  assert.equal(weekCompleteBonus(4), 1000);
});

test("streakMilestoneBonus unlocks 7d/14d/30d cumulatively", () => {
  assert.equal(streakMilestoneBonus(0), 0);
  assert.equal(streakMilestoneBonus(6), 0);
  assert.equal(streakMilestoneBonus(7), 100);
  assert.equal(streakMilestoneBonus(13), 100);
  assert.equal(streakMilestoneBonus(14), 300); // 100 + 200
  assert.equal(streakMilestoneBonus(29), 300);
  assert.equal(streakMilestoneBonus(30), 800); // 100 + 200 + 500
  assert.equal(streakMilestoneBonus(147), 800);
});

/* ------------------------------ level curve ----------------------------- */

test("costToNext: round-to-nearest-50 of 0.25N²+10N+140", () => {
  assert.equal(costToNext(1), 150); // 150.25 → 150
  assert.equal(costToNext(4), 200); // 184 → 200
  assert.equal(costToNext(10), 250); // 265 → 250
  assert.equal(costToNext(20), 450); // 440 → 450
  assert.equal(costToNext(30), 650); // 665 → 650
  assert.equal(costToNext(50), 1250); // 1265 → 1250
});

test("costToNext is unreachable at/above the cap", () => {
  assert.equal(costToNext(LEVEL_CAP), Number.POSITIVE_INFINITY);
  assert.equal(costToNext(LEVEL_CAP + 5), Number.POSITIVE_INFINITY);
});

test("levelForXp: spot values and intra-level progress", () => {
  assert.deepEqual(levelForXp(0), { level: 1, xpIntoLevel: 0, xpToNext: 150 });
  assert.deepEqual(levelForXp(149), { level: 1, xpIntoLevel: 149, xpToNext: 150 });
  assert.deepEqual(levelForXp(150), { level: 2, xpIntoLevel: 0, xpToNext: 150 });
  // reach L3 at 300 (150 + 150).
  assert.equal(levelForXp(300).level, 3);
  assert.equal(levelForXp(449).level, 3);
});

test("levelForXp is monotonic in XP", () => {
  let prev = 1;
  for (let xp = 0; xp <= 60000; xp += 137) {
    const lvl = levelForXp(xp).level;
    assert.ok(lvl >= prev, `level dropped at ${xp}`);
    prev = lvl;
  }
});

test("levelForXp caps at LEVEL_CAP with xpToNext 0", () => {
  const capped = levelForXp(10_000_000);
  assert.equal(capped.level, LEVEL_CAP);
  assert.equal(capped.xpToNext, 0);
  assert.ok(capped.xpIntoLevel > 0);
});

/* ------------------------- mission-item (quest) XP ---------------------- */

test("xpForMissionItem: task-backed uses task XP; review/drill/other fall back", () => {
  assert.equal(
    xpForMissionItem(
      { kind: "leetcode", taskId: "t1" },
      { kind: "leetcode", difficulty: "Hard" },
    ),
    300,
  );
  assert.equal(xpForMissionItem({ kind: "drill" }), 50);
  assert.equal(xpForMissionItem({ kind: "review" }), 75);
  assert.equal(xpForMissionItem({ kind: "video" }), 75);
  // taskId present but task missing → falls back to kind.
  assert.equal(xpForMissionItem({ kind: "leetcode", taskId: "x" }), 50);
});

/* ------------------------------ XP by date ------------------------------ */

test("xpOnDay sums events on the given calendar day only", () => {
  const events: XpEvent[] = [
    { date: "2026-07-05T09:00:00.000Z", xp: 150 },
    { date: "2026-07-05", xp: 75 },
    { date: "2026-07-04T23:00:00.000Z", xp: 50 },
  ];
  assert.equal(xpOnDay(events, "2026-07-05"), 225);
  assert.equal(xpOnDay(events, "2026-07-04"), 50);
  assert.equal(xpOnDay(events, "2026-07-06"), 0);
});

test("weeklyXpBuckets: trailing 7-day buckets, oldest-first, current last", () => {
  const events: XpEvent[] = [
    { date: "2026-07-05", xp: 100 }, // this week (today)
    { date: "2026-07-01", xp: 50 }, // this week
    { date: "2026-06-28", xp: 30 }, // previous week (7d..13d back)
    { date: "2026-05-01", xp: 999 }, // outside the 3-week window
  ];
  const buckets = weeklyXpBuckets(events, 3, "2026-07-05");
  assert.equal(buckets.length, 3);
  assert.equal(buckets[2], 150); // current week
  assert.equal(buckets[1], 30); // one week back
  assert.equal(buckets[0], 0); // two weeks back (nothing)
});
