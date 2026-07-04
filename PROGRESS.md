# MentorOS — Build Progress Log

> Your working memory across sessions. Read this first on any fresh session, then read `plan.md`.
> Update this at every phase gate and before ~60% context usage. **Never** move volatile state back into `plan.md`.

## Current status
- **Phase:** 1 COMPLETE (1a+1b+1c built, verified, committed). **At the hard Phase-1 check-in gate — waiting for user approval + live demo before Phase 2.**
- **Next step (after approval):** Phase 2 — Knowledge Memory (memory records + LanceDB embeddings + upsert-by-similarity + recall injection + graph).
- **1b verified:** streaming ladder over WS; stop→partial persistence; Ollama-offline designed banner + error event; SQLite at userData/data. Screenshots `/1b/`.
- **1c verified:** whisper small.en arm64+Metal (~514ms warm) + Kokoro af_heart (~560ms TTFC) sidecars, /voice WS matches contract exactly; UI: real TTS → orb speaking → idle on tts-end; interrupt ducks; 4 orb states visually distinct; reduced-motion FallbackOrb OK. Screenshots `/1c/`.
- **Needs the user live (first run):** macOS mic permission prompt → real hold-Space voice loop; network-off repeat; ⌥Space may need Accessibility permission; first whisper call pays one-time ~7s Metal shader compile.
- **Known 1c gaps (deliberate):** no interim transcripts (final on release only); barge-in is PTT/tap-triggered, hands-free VAD later; wake word deferred to onboarding phase.
- **Approved Phase-1 execution plan:** `~/.claude/plans/read-plan-md-and-eager-blossom.md`.

## Decisions log
- Node via nvm v22.16.0 (`.nvmrc`), pnpm via corepack. Machine default node is v12 — always `export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"`.
- Stack pins: electron 43, electron-vite 5, vite 7 (peer range), react 18.3, tailwind v4 (`@theme inline` maps Nocturne vars), fastify 5 + @fastify/websocket, motion, zustand, lucide, fontsource variable fonts (bundled).
- Core server runs in-process in Electron main (core has zero electron imports); port 4820 scan-up; renderer discovers via `?corePort=` query param.
- Added @fastify/cors (localhost origins + `null` for packaged file://) — renderer health fetch was CORS-blocked in dev (verifier caught it).
- Default local model: `llama3.1:8b` (installed; clean streaming — qwen3 emits <think> blocks).
- Design-review nits deferred: context panel should auto-collapse under ~900px width; light-theme `--faint` contrast re-check when real screens land.
- CDP screenshot recipe: `pnpm --filter @mentoros/desktop dev -- --remote-debugging-port=9222` (single `--`), drive via ws + Page.captureScreenshot. 1a screenshots in scratchpad `/1a/`.

- 1c research (done): STT = whisper.cpp (`brew install whisper-cpp` or source w/ GGML_METAL), model `ggml-small.en.bin` (466 MiB, HF ggerganov/whisper.cpp); no native WS streaming — use whisper-stream/server or wrap. TTS = **Kokoro instead of Piper** (Piper repo archived Oct 2025, python-only fork, seconds-level latency; Kokoro ~100ms TTFA on M4 Pro via kokoro/kokoro-mlx, 24kHz PCM streaming). Piper fallback: OHF-Voice/piper1-gpl + en_US-lessac-medium.
- Voice-loop state machine + CSS FallbackOrb already written (`renderer/orb/orbState.ts`, `FallbackOrb.tsx`) — shader Orb + audio plumbing still pending in 1c.

- better-sqlite3 must be built for **arm64** (nvm node is x86_64/Rosetta but Electron is arm64): postinstall pinned to `electron-rebuild -f -w better-sqlite3 --arch arm64`.
- 1b core-engineer run was killed by a session limit mid-task; Fable finished the last wiring (dataDir passthrough, arm64 rebuild) per the escalate-once rule.
- `pkill -f ollama` is case-insensitive-trap: menubar app is `Ollama` (capital) and respawns `ollama serve`; use `pkill -9 -f -i ollama` in tests, restore with `open -a Ollama`.

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
