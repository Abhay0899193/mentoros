# MentorOS — Build Progress Log

> Your working memory across sessions. Read this first on any fresh session, then read `plan.md`.
> Update this at every phase gate and before ~60% context usage. **Never** move volatile state back into `plan.md`.

## Current status
- **Phase:** 1 — Stage 1a DONE (verified + design-audited). Stage 1b (local chat) starting.
- **Next step:** 1b — Fable builds Chat screen (§4.2); core-engineer builds Ollama adapter + SQLite threads + degraded states behind the coreClient contract.
- **Approved Phase-1 execution plan:** `~/.claude/plans/read-plan-md-and-eager-blossom.md`. User chose **non-blocking 1a gate** (screenshots posted async, build continues).

## Decisions log
- Node via nvm v22.16.0 (`.nvmrc`), pnpm via corepack. Machine default node is v12 — always `export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"`.
- Stack pins: electron 43, electron-vite 5, vite 7 (peer range), react 18.3, tailwind v4 (`@theme inline` maps Nocturne vars), fastify 5 + @fastify/websocket, motion, zustand, lucide, fontsource variable fonts (bundled).
- Core server runs in-process in Electron main (core has zero electron imports); port 4820 scan-up; renderer discovers via `?corePort=` query param.
- Added @fastify/cors (localhost origins + `null` for packaged file://) — renderer health fetch was CORS-blocked in dev (verifier caught it).
- Default local model: `llama3.1:8b` (installed; clean streaming — qwen3 emits <think> blocks).
- Design-review nits deferred: context panel should auto-collapse under ~900px width; light-theme `--faint` contrast re-check when real screens land.
- CDP screenshot recipe: `pnpm --filter @mentoros/desktop dev -- --remote-debugging-port=9222` (single `--`), drive via ws + Page.captureScreenshot. 1a screenshots in scratchpad `/1a/`.

## Open questions for the user
- (none)

## File map
- `plan.md` — the spec (read-only during builds) · `CLAUDE.md` — agent instructions · `PROGRESS.md` — this file
- `apps/desktop/src/main/` Electron main · `src/core/` Fastify core server · `src/preload/` empty seam
- `src/renderer/theme/` tokens.css + ThemeProvider · `motion/springs.ts` · `ui/` primitives (Button, Card, Chip, Keycap, Panel, Overlay, Toast, Spinner)
- `src/renderer/app/shell/` AppShell, Rail, TitleBar, ContextPanel, CommandPalette · `app/screens/` Showcase, Placeholder
- `src/renderer/lib/` coreClient.ts (typed boundary — Fable owns the contract), store.ts, seed.ts, cn.ts

## Phase checklist
- [ ] Phase 1 — First Win: Voice + Orb magic moment (Stages 1a foundation/design-system, 1b local chat, 1c voice+orb)
- [ ] Phase 2 — Knowledge Memory
- [ ] Phase 3 — Daily Loop (Home + Learning)
- [ ] Phase 4 — Knowledge Base + Hybrid Search
- [ ] Phase 5 — Interview Platform
- [ ] Phase 6 — Codebase Mentor + Career Dashboard
- [ ] Phase 7 — Polish, Ownership & Optional Cloud
