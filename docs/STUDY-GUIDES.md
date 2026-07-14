# Study Guides — week deep-dives + topic docs

Status: **Rules + week-1 split shipped (2026-07-14). Week guides are authored
on demand via the `/generate-guide` skill.**

## The canonical spec lives with the content

**`3-month-challenge/STUDY-GUIDES/RULES.md`** is the single source of truth
for what a guide part must contain (the "clears any interview on the topic"
bar, required sections, frontmatter shape, mermaid policy, line budget). This
file is only the app-side pointer — do not duplicate the rules here.

## Layout & import pipeline

- `STUDY-GUIDES/week-NN/NN-topic-slug.md` — one part per technique/topic per
  week; `00-overview-decision-map.md` first. Exemplar: `week-01/` (6 parts).
- `STUDY-GUIDES/custom/` — supplementary docs generated in-app (Phase G);
  never week guides.
- `SKILLS-TRACK/*.md` — the 12 original 3mc quick-review sheets.
- The 3mc importer walks `STUDY-GUIDES/**/*.md` recursively (RULES.md
  excluded), tags from frontmatter (`study-guide`, `week:N`, `topic:<slug>`,
  `part:N`; sheets get `quick-review` + weeks), links `weeks:` to Learning
  weeks, and prunes 3mc KB sources whose backing file vanished. Boot
  auto-sync (digest drift) picks up newly authored guides on next launch;
  ⌘K → "Sync learning plan" is the manual path.
- ```mermaid fences render as Nocturne-themed SVG in the Knowledge reading
  view (`MermaidDiagram.tsx`); a parse failure falls back to a code block.

## How guides get made (user decisions, 2026-07-14)

- **Week guides — `/generate-guide week N` in Claude Code, on demand.** The
  skill (`.claude/skills/generate-guide/SKILL.md`) reads RULES.md + the plan
  week + day notes, authors the part files, and the app auto-syncs. Quality
  bar is Claude-Code-authored, not local-model.
- **In-app "Generate guide" (Phase G)** produces supplementary docs into
  `STUDY-GUIDES/custom/` via the model router — explicitly NOT week guides.
