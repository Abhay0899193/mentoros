# Study Guides — week deep-dives + topic mastery docs

Status: **Week 1 exemplar shipped, generation feature awaiting user approval.**

## What exists now (2026-07-14)

- The 3mc importer ingests two doc folders from the challenge repo into the
  Knowledge base and links them to Learning-path weeks via frontmatter
  (`weeks: [1, 2]`), rendered as "Quick review" chips on each week:
  - `SKILLS-TRACK/*.md` — the 12 original 3mc skill reference sheets
    (Docker, PostgreSQL, Redis, Kafka, K8s, …), tag `quick-review`.
  - `STUDY-GUIDES/*.md` — deep week/topic study guides, tag `study-guide`.
- Exemplar: `3-month-challenge/STUDY-GUIDES/week-01-arrays-strings-two-pointers-docker.md`.
  **This is the template** — user approves/amends its shape before more are made.

## The exemplar's template (what every week guide contains)

1. **Prerequisites banner** — what to read first, what later weeks build on
   this ("read recursion before linked-list recursion" pointers).
2. **The week's map** — ASCII decision tree: which technique for which cue,
   with importance ratings (★–★★★★★).
3. **Per-technique sections** — intuition + ASCII visualization, the reusable
   template in **Python and Java** with the transferable core explicitly
   marked vs the per-problem part, time/space complexity, this week's problems
   mapped onto it, special tricks + classic traps, related problems beyond the
   week.
4. **Problem table** — every plan problem with technique + the one key idea,
   plus a progressive re-solve order.
5. **Tech-skill half** (Docker/SQL/…) — one mental-model picture, command
   crib, gotchas, interview angle; deep content stays in the SKILLS-TRACK doc.
6. **Self-check questions** — prove-it prompts, not recall prompts.

## Proposed next phase (needs approval — check-in question)

Two ways to produce the remaining ~20 week guides + completed-topic mastery
docs (e.g. "DSA: Arrays & Hashing — complete", "Docker — complete" once its
weeks finish):

- **Option A — in-app generation (recommended):** "Generate study guide"
  button on a week (and on a finished topic). Core builds a rich prompt from
  the plan data (topics, problems, day notes) + the template above, runs it
  through the existing model router (cloud when key present, local fallback),
  writes the markdown into the 3mc `STUDY-GUIDES/` folder, re-ingests into KB,
  links the week. Scales to plan edits; costs the user's API key per guide
  (~1 Opus call each); quality depends on the routed model.
- **Option B — batch-authored by Claude Code:** author all guides in sessions
  like the exemplar. Highest quality/consistency, no in-app feature, but ~20
  large documents of token spend and they go stale if the plan changes.

Open questions for the user at check-in:
1. Approve/amend the Week-1 template?
2. Option A or B (or B for near-term weeks, A as the feature)?
3. Topic mastery docs: generate when the topic's last week completes
   (auto-suggest) or on demand only?
