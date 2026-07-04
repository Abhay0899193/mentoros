# MentorOS — Agent Instructions

**`plan.md` is the complete spec for this project. Read it fully before doing anything.** It contains the product vision, the "Nocturne" design system (your token registry), every screen spec, and a phased build plan you drive yourself.

## Non-negotiable operating rules (from `plan.md`)

1. **Check-in Protocol (plan.md §0.4).** Build **one phase at a time**. At the end of every phase: run the app, capture screenshots of all key states, post a short "Phase N delivered" summary, then **STOP and wait for the user's approval before the next phase.** Never chain past a phase gate on your own.

2. **Token-efficiency rules (plan.md §0.6).**
   - **`plan.md` is read-only during a build.** Do not rewrite/reorder/reformat it — it's an immutable cached prefix. All volatile state goes in `PROGRESS.md`.
   - Default to `high` effort; spend `max`/`xhigh` only on the design-system foundation and the GLSL Orb shader.
   - Route routine work (CRUD, settings, wiring, test scaffolding) to cheaper-model sub-agents.
   - Run verbose work (app runs, tests, installs, indexing) in sub-agents; return only summaries.
   - Edit via targeted diffs, never full-file rewrites. Read only the lines you need. Be terse in-thread.

3. **Design Invariants (plan.md §3.0).** Dark-first + surface ladder (not shadows); monochrome chrome, color only on the Orb/state/data; spring motion (never linear); keyboard-first (`⌘K`); teaching posture in the UI; 60fps. Verify every screen against these with **vision self-verification** (screenshot dark + light, all interactive states) before calling it done.

4. **Realistic data only (plan.md Part 9).** Use the Abhay/SDE3 seed data everywhere — never lorem ipsum.

5. **Architecture boundary (plan.md §2.2).** All core calls go through `lib/coreClient.ts`. No screen imports `electron` directly — this keeps the future web/mobile/SaaS path open.

## Sub-agents — delegate to keep cost down (plan.md §0.6)
Route work to the cheapest capable worker. **Keep on Fable 5 (yourself) only:** the design-system foundation, the GLSL Orb shader, and the hero Chat/Voice screens.

- **builder** (Sonnet) — routine UI screens, forms, list views, simple wiring, test scaffolding.
- **core-engineer** (Opus 4.8) — non-visual core: Electron main, sidecar supervision, SQLite/FTS5, LanceDB, memory upsert, router, `coreClient`.
- **verifier** (Sonnet) — run app/tests/installs/logs in isolation; returns a summary only. Use before every check-in.
- **design-reviewer** (Sonnet) — screenshot each screen (dark+light+states) and audit against §3.0 invariants. Use at the end of every screen/phase.
- **researcher** (Haiku) — read-only lookups (library APIs, integration specifics, current model IDs/pricing).

Delegate verbose work (runs, tests, installs, indexing, doc lookups) so only summaries return to your context.

## Session start / resume
- On a fresh session, read `PROGRESS.md` first to see current state and the exact next step, then read `plan.md`.
- Leave the tree clean and runnable at every stop. Update `PROGRESS.md` before ~60% context usage and at every phase gate.

## Current status
See `PROGRESS.md`. **Nothing is built yet — start with Phase 1, Stage 1a, and produce your execution plan in plan mode before writing code.**
