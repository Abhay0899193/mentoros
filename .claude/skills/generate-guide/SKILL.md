---
name: generate-guide
description: Author deep per-topic study-guide parts for a 3-month-challenge week (or a single topic) into the 3mc STUDY-GUIDES folder, following its RULES.md bar. Use when the user says /generate-guide, asks for a study guide for week N, or asks to (re)write guide parts for a topic.
---

# /generate-guide — author week/topic study guides

Input: `week N` (e.g. `week 2`), or a topic (e.g. `topic linked-lists`), or
`week N --regen <part-slug>` to rewrite one existing part.

The 3mc repo lives at `../3-month-challenge` relative to the mentoros repo
root (absolute: `/Users/singha7/Documents/abhay/3-month-challenge`).

## Procedure

1. **Read the rules first**: `3-month-challenge/STUDY-GUIDES/RULES.md` is the
   canonical bar and template — required sections, frontmatter shape, the
   ≤~250-lines-per-part limit, mermaid-vs-ASCII policy. Non-negotiable.
2. **Gather the week's material** (read-only):
   - The plan JSON (`study-ui/public/study-plan.json`, fall back to
     `study-ui/data/parsed-plan.json`) — filter to week N: its topics, tasks,
     LeetCode problems with difficulty.
   - Day notes: `PHASE-<p>/week-<NN>/day-<DD>.md` for that week (the study
     content — concepts, hands-on).
   - Related `SKILLS-TRACK/*.md` sheets whose `weeks:` include N (do not
     duplicate their content — link to them, per RULES.md).
   - An existing exemplar: `STUDY-GUIDES/week-01/` shows the target quality.
3. **Decide the split**: one part per distinct technique/topic in the week,
   plus `00-overview-decision-map.md` (decision map + problems table + solve
   order). Typically 4–7 parts. For a topic input, produce just that part in
   the week folder it belongs to.
4. **Author** into `3-month-challenge/STUDY-GUIDES/week-NN/` as
   `NN-topic-slug.md`, each meeting every RULES.md section (recognition cues,
   intuition + mermaid, dual-language templates with marked core, complexity
   with the why, ONE narrated worked example, tricks/traps, interviewer
   follow-ups with model answers, edge-case checklist, ★ ladder, self-check).
   Frontmatter: `{title, weeks: [N], topics: ["area/slug"], part: NN,
   outcomes: [...]}` — MentorOS's importer turns these into week links,
   Knowledge collections, and part ordering, so get them exactly right.
5. **Quality gate before finishing**: re-read each part against RULES.md
   §"Required sections" as a checklist. The bar: reading the part + doing its
   mapped problems clears any interview on the topic. No filler, no lorem,
   no restating sibling parts.
6. **Tell the user**: list the files written, and remind them that the next
   MentorOS launch auto-syncs (boot digest check) — or ⌘K → "Sync learning
   plan" to import immediately. Do NOT touch the mentoros app code or DB.

## Boundaries

- Write ONLY under `3-month-challenge/STUDY-GUIDES/`. Never edit day notes,
  the plan JSON, or SKILLS-TRACK sheets.
- Never delete a guide the user didn't ask to regenerate; when regenerating,
  overwrite in place (same filename) so KB re-ingest stays idempotent.
- In-app generated supplementary docs live in `STUDY-GUIDES/custom/` — leave
  that folder alone; it belongs to the app's "Generate guide" feature.
