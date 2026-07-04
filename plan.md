# MentorOS — Build & Design Plan
### A self-driving, phased handoff document written for **Claude Fable 5**

> **Fable 5 — read this first.** This document is your complete, self-contained brief. It has the full product context, the exact design system, every screen spec, and a **phased build plan you drive yourself**. You build **one phase at a time**, verify your own work with vision, then **stop and check in with the user before continuing** (see §0.4 The Check-in Protocol). Do not build all phases in one run. Deliver the first thing, show it, get input, continue.

---

## Part 0 — Your Operating Manual (how to execute this plan)

### 0.1 What you're building, in one breath
**MentorOS**: a **local-first desktop app that is a permanent, personalized AI mentor for software engineers.** It remembers *you* (goals, strengths, weaknesses, progress), teaches instead of just answering, is voice-first, and works offline. The UI must feel *admired* — calm, premium, alive — not like a generic chatbot.

### 0.2 Your working principles (tuned to your strengths)
You are strongest at one-shotting whole multi-screen flows while holding a design system together, and at verifying your own output with vision. Lean into that:

1. **Design system before components.** Part 3 is your token registry. Wire it into `theme/tokens.css` + Tailwind config *before* building any screen. Every screen pulls from these tokens — never hardcode a hex, radius, or spring value.
2. **Vertical slices, not horizontal layers.** Build one screen end-to-end (UI → state → local data → verified) before starting the next. Do **not** build "all the DB, then all the API, then all the UI." Each phase in Part 6 is a vertical slice.
3. **Vision self-verification is mandatory.** After building a screen: run the app, screenshot it in **dark and light**, at desktop and narrow widths, trigger hover/focus/loading/empty/error states, and **compare against the Design Invariants (§3.0)**. Fix drift before moving on. Also open the console and clear warnings.
4. **Realistic data, never lorem.** Use the seed data in Part 9 (Abhay, SDE3 → Staff, real interview scores, real stack). Placeholder text makes good design look cheap and removes your verification targets.
5. **Every interactive state, every time.** Hover, focus, active, disabled, loading (skeletons, not spinners-in-silence), empty (never a blank box), error (offer a next action). These are part of "done," not extras.
6. **Effort dial per phase** (spend where it matters — see §0.6 for how these map to the real effort parameter and model routing). Phase labels: **Ultra** = `max`/`xhigh`, reserved for genuinely frontier-hard visual work only (the design-system foundation and the GLSL Orb shader inside Phase 1, complex animation choreography); **Extra** = `high` (data-dense screens that must stay calm — Memory, Interview, Career); **Medium** = `medium` (routine CRUD — Knowledge Base list, Settings). **Default to `high`; only escalate to `xhigh`/`max` with evidence it improves the result.**

### 0.3 Staying oriented across sessions
- Maintain **`PROGRESS.md`** at the repo root. After each phase (and before you hit ~60% context), append: what's done, what's verified, current file map, and the exact next step. Treat it as a note to your future self so a fresh session resumes instantly.
- Leave the tree in a **clean, runnable state** at every stop — code that could merge to main: no broken build, no dead screens, no TODO-blocked flows.

### 0.4 The Check-in Protocol (THIS IS HOW THE PROJECT IS STAFFED)
The user wants to build this **with** you, phase by phase — not receive a finished blob.

**At the end of every phase you MUST:**
1. Run the app and **capture screenshots** of what you built (all key states).
2. Post a short **"Phase N delivered"** summary: what works, what you verified, any decisions you made, and any open questions.
3. **STOP and ask for the user's input/approval before starting the next phase.** Offer the next phase's plan in 2–3 lines so they can redirect.

Never chain past a phase gate on your own. The gates in Part 6 are hard stops. Phase 1 is "the first thing we want" — deliver it, show it, then wait.

### 0.5 What to emulate (reference bar)
Aim for the craft level of **Linear** (calm density, keyboard-first, buttery motion), **Raycast** (dark surface-ladder discipline, glass command palette), **Superhuman** (inline shortcut hints that fade with mastery), and **Arc/Warp** (dark-first as the primary design surface). When you reference a specific pattern from one of these, note it in your phase summary so decisions are traceable. Do **not** copy their exact colors — MentorOS has its own language ("Nocturne", Part 3).

### 0.6 Token-efficiency rules (keep your own cost low — follow these every turn)
You are expensive ($10/M input, $50/M output, and **thinking tokens bill even though they aren't returned**). These rules cut effective spend 40–70% with **no quality loss**. Treat them as hard operating constraints.

1. **Keep this plan a stable, cached prefix.** `plan.md` is **read-only during a build** — do not rewrite, reorder, or reformat it. A stable plan is served from prompt cache at ~10% of input cost on every turn; editing it mid-build invalidates the cache and re-bills the whole thing. All volatile state (what's done, next step, decisions) goes in **`PROGRESS.md`**, never back into `plan.md`. If the plan genuinely needs to change, note it in `PROGRESS.md` and ask the user to amend `plan.md` **between phases**, not mid-phase.
2. **Right-size effort; default to `high`.** Map the phase labels (§0.2.6): Ultra→`max`/`xhigh`, Extra→`high`, Medium→`medium`. Spend `max`/`xhigh` **only** on the design-system foundation, the GLSL Orb shader, and complex animation choreography. Never run high effort on CRUD, settings, or list screens.
3. **Route routine work to a cheaper model.** Delegate boilerplate (CRUD screens, settings forms, simple wiring, test scaffolding) to sub-agents backed by a cheaper model (Opus 4.8 / Sonnet). Reserve Fable 5's own turns for the hard, high-visual-value slices. Escalate to Fable only after a cheaper model fails once.
4. **Delegate verbose work to sub-agents.** Running the app, tests, installs, log inspection, and repo indexing emit huge output. Run them in **sub-agents** so only a short summary returns to the main thread. Keep the main context lean — it's what gets cached and re-sent every turn.
5. **Edit with diffs; read with precision.** Modify files via **targeted diffs, never full-file rewrites** (a diff is often ~5% of the tokens). Read only the lines you need, not whole files. Never re-emit code you already wrote.
6. **Be terse in-thread.** Check-in summaries and reasoning are concise — no filler, no pleasantries, no restating this plan back to the user, no narrating what you're about to do. Show screenshots + a short bulleted delta.
7. **Cap and monitor autonomous runs.** Use spend/task caps so a looping build can't run away at $50/M output. Check `stop_reason` on every response; **never blind-retry a refusal** at Fable rates — reroute to the cheaper model instead. Watch cache-hit, truncation, and refusal rates.
8. **Size `max_tokens` for thinking + output.** Truncation bills in full **and** forces a retry (paying twice). Budget for thinking overhead so responses don't truncate. Note: Fable 5 uses the Opus 4.7 tokenizer (~30–35% more tokens than older counts) — re-baseline any token estimates.

---

## Part 1 — Product Vision (context for good micro-decisions)

**The problem.** Today's AI dev tools are stateless commodity wrappers: they forget you when the session ends, hand out answers instead of teaching, and lock your data in the cloud so they die when credits run out.

**The bet.** Long-term structured memory *of you* + offline-capable + teaching-not-solving. Hard to replicate; it's why users invest years (and pay).

**Five principles — every feature must satisfy all five:**
1. **Offline-first** — every feature has a local path that works with no internet.
2. **AI is optional** — cloud models (Claude/GPT) are an accelerator behind a router, never a dependency.
3. **Composable** — voice, memory, search, interviews, review are independent modules.
4. **Privacy by default** — data local; sync is explicit opt-in.
5. **Dogfood** — every feature solves a real problem a senior engineer hits.

**The nine modules:** Voice OS · Engineering Mentor (personas) · Knowledge Memory · Interview Platform · Learning Engine · Project Mentor · Personal Knowledge Base · Career Coach · Daily Companion.

---

## Part 2 — Architecture & Deployment

### 2.1 Runtime
```
┌───────────────────────── Desktop shell (Electron) ─────────────────────────┐
│  Renderer: React + Vite + Tailwind  ⇄ (typed client) ⇄  Core server (Node) │
└──────────────────────────────────────────────────────────┬────────────────┘
                                                            │ supervises sidecars
     ┌──────────────┬──────────────┬──────────────┬─────────┼──────────────┐
     ▼              ▼              ▼              ▼          ▼              ▼
  Ollama        whisper.cpp     Piper/Kokoro    SQLite+FTS5  LanceDB   (cloud, opt-in)
 (local LLM)    (speech→text)   (text→speech)   (records)   (vectors)  Claude/GPT
```

### 2.2 Deployment architecture — **one frontend, three shells** (decided; keep this boundary clean)
The React frontend talks to the **core** only through a **typed client interface over HTTP/WebSocket** — never through Electron-specific globals. The core is framework-agnostic TypeScript. This buys the "easy to ship later" property *and* the native powers voice needs:

- **Today — Desktop shell (Electron):** gives the native capabilities the product can't live without: global hotkey / push-to-talk, system tray, wake-word background listening, unrestricted mic + filesystem (index repos & docs), and the ability to spawn the whisper/Piper/Ollama sidecars. A pure browser tab **cannot** do these — it would silently kill Voice OS, Project Mentor, and the always-present Daily Companion. So we ship desktop first.
- **Later — Web / mobile / hosted SaaS:** because the frontend↔core boundary is a clean network API, the *same* React app and *same* core can be served remotely for the Pro/SaaS tier with **no UI rewrite**. Cloud sync becomes an opt-in feature, not a dependency.
- **Optional — Tauri re-host:** core has zero Electron imports, so if footprint ever matters, the shell can swap to Tauri without touching business logic.

**Rule for you, Fable 5:** put all core calls behind `lib/coreClient.ts`. No screen imports `electron` directly. This one discipline is what keeps the SaaS/mobile door open.

### 2.3 The memory model (the differentiator)
Store **knowledge, not conversations.** Typed, embeddable, **upsert-by-similarity** records — so "weaknesses: graphs, DP" is one evolving record, not 50 chat fragments. Types: `identity, goal, skill, learning, project, career, preference, mistake, achievement, repo, meeting, book, research`. Profile stats (interview scores, reading %, skill deltas) are **derived views** over these records.

### 2.4 AI routing (cloud as accelerator)
local model → local docs/KB search → (only if enabled + within budget) cloud → **cache result forever** ("never ask again"). The router interface exists from day one but returns "cloud disabled" until Phase 8. When you build the Claude adapter, look up current model IDs/pricing rather than hardcoding.

### 2.5 Data ownership
One portable data folder (SQLite + LanceDB + config). Export/backup is a first-class feature.

---

## Part 3 — The "Nocturne" Design System (your token registry — wire this first)

### 3.0 Design Invariants (NON-NEGOTIABLE — verify every screen against these)
1. **Dark-first, calm, near-black.** Depth = **surface ladder + hairline borders**, not heavy shadows. Light theme exists but dark is the primary surface.
2. **Monochrome chrome, colored state.** Buttons/text/chrome are neutral. Saturated color appears only in: the **Orb**, status indicators, data viz, and category glyph tiles — never on generic buttons or body text.
3. **One living element.** The **Orb** is the emotional center — breathes idle, reacts to audio when active. Nothing competes with it for "aliveness."
4. **Spring motion, never robotic.** Meaningful motion uses spring physics. Linear/instant transitions are banned for entrances, layout shifts, state changes. Everything degrades under `prefers-reduced-motion`.
5. **Keyboard-first.** Every action reachable via `⌘K` and has a shortcut. Mouse optional.
6. **Teaching posture in the UI.** Answer surfaces reveal progressively (hints → approach → solution behind a "Reveal"). The UI must *look* like a mentor.
7. **60fps or it doesn't ship.** Animate `transform`/`opacity` only. Orb runs on the GPU (shaders), never blocks the main thread.

### 3.1 Color tokens (CSS variables; dark default + light override)
```css
:root {
  /* Surface ladder — cool near-black, faint indigo undertone */
  --canvas:#0A0B0F; --surface-1:#101218; --surface-2:#161922; --surface-3:#1D212C;
  --glass:rgba(255,255,255,0.04); /* + backdrop-blur(16px) on overlays only */

  /* Text ink ladder */
  --ink:#F5F7FA; --body:#C7CCD6; --muted:#8A909E; --faint:#5A6070;

  /* Hairlines = depth, not shadow */
  --line:rgba(255,255,255,0.07); --line-strong:rgba(255,255,255,0.12);

  /* Signature accent — "Iris" + Aurora gradient (Orb + focal only) */
  --iris:#7C7CFF; --iris-dim:#5E5ED6;
  --aurora:linear-gradient(135deg,#6D6BF6 0%,#A66BFF 50%,#45D6E0 100%);
  --aurora-glow:0 0 40px 0 rgba(124,124,255,0.35);

  /* Semantic (status/data only) */
  --success:#46D6A0; --warning:#F5B84B; --danger:#FF6B6B; --info:#57C1FF;

  /* Focus ring */
  --focus:0 0 0 2px var(--canvas),0 0 0 4px var(--iris);
}
:root[data-theme="light"]{
  --canvas:#F7F8FA; --surface-1:#FFFFFF; --surface-2:#F1F3F7; --surface-3:#E7EAF0;
  --glass:rgba(10,11,15,0.03);
  --ink:#12141A; --body:#3A414E; --muted:#6A7180; --faint:#A4ABB8;
  --line:rgba(10,11,15,0.08); --line-strong:rgba(10,11,15,0.14);
  --iris:#5E5ED6; --iris-dim:#4A4ABF;
}
```
**Accent rule:** module glyph accents (Interview=violet, Learning=cyan, Career=green…) live **only inside their glyph tile / illustration**. The Aurora gradient appears on: the Orb, the active nav indicator, progress/streak fills, and at most one hero element per screen.

### 3.2 Typography
- **UI + display:** `Inter` variable, `font-feature-settings:"cv11","ss01","calt","kern"`.
- **Code / metrics / scores:** `JetBrains Mono` variable, **tabular figures** for anything numeric that changes (scores, timers, token counts).
- **Optional editorial warmth:** `Instrument Serif` for the Daily Companion greeting only. Skip if it risks bundle/offline.

| Token | Size | Wt | LH | Tracking | Use |
|---|---|---|---|---|---|
| display | 40 | 600 | 1.1 | -0.02em | hero/greeting |
| h1 | 28 | 600 | 1.2 | -0.01em | page title |
| h2 | 20 | 600 | 1.3 | -0.01em | section |
| h3 | 16 | 600 | 1.4 | 0 | card title |
| body | 15 | 400 | 1.6 | 0 | default |
| small | 13 | 400 | 1.5 | 0 | secondary |
| label | 12 | 500 | 1.4 | 0.02em | UPPERCASE chips |
| mono | 13 | 450 | 1.5 | 0 | code/metrics (tabular) |

### 3.3 Spacing / radius / elevation
- **Spacing (4px base):** 2·4·8·12·16·20·24·32·40·64·96. Section rhythm 64/96. Card padding 20 (compact) / 24 (feature).
- **Radius:** sm 8 · md 10 · lg 14 · xl 20 · pill 9999. Cards=14, buttons/inputs=10, popovers=14, pills/avatars=full.
- **Elevation = surface ladder + hairline.** Shadows allowed only for floating overlays (`0 8px 30px rgba(0,0,0,.45)`), the Orb glow (`--aurora-glow`), and focus rings. Glass (`--glass` + `backdrop-blur(16px)` + 1px `--line`) only for command palette, toasts, floating Orb dock.

### 3.4 Motion system (Motion library — Framer Motion's successor)
```ts
export const spring = {
  snappy:{type:"spring",stiffness:420,damping:34,mass:0.8}, // buttons, toggles, hover
  smooth:{type:"spring",stiffness:240,damping:30},          // panels, layout shifts
  gentle:{type:"spring",stiffness:130,damping:22},          // entrances, large moves
} as const;
export const easePremium=[0.2,0.8,0.2,1] as const;
export const dur={micro:0.12,base:0.2,enter:0.32};
```
- **Entrances:** fade + 6–10px rise, `spring.gentle`, staggered 30–40ms in lists.
- **Layout:** shared-layout (`layout` prop) with `spring.smooth`. No jump-cuts.
- **Micro:** hover/press scale 0.98–1.02 `spring.snappy`; keycaps depress 1px.
- **Streaming text:** per-word fade-in (not per-char); soft pulsing caret.
- **Reduced motion:** springs → 120ms opacity fades; Orb freezes to a calm gradient.

### 3.5 Icons & imagery
- **Lucide** only (1.5px stroke, 20px default). Never mix icon sets.
- Module glyphs: custom gradient tiles (48–64px, radius md) — the only home for saturated category color.
- No stock photos. Illustration = geometric/gradient in the Aurora palette.

---

## Part 4 — Screen-by-Screen Specification

**App shell:** left rail (collapsible) · main canvas · right context panel (memory/sources). Persistent **Orb dock** floats bottom-center. **⌘K palette** overlays all. Frameless window with native traffic lights (macOS) / custom controls (Win).

### 4.0 App shell & navigation
Left rail 64→240px; module icons (Home, Chat, Voice, Memory, Interview, Learning, Knowledge, Codebase, Career) with an **Aurora vertical indicator** that glides between items (shared-layout). Bottom: settings, theme toggle, sync-status dot. Frameless draggable title bar with `⌘K` search pill. Right context panel shows *what the mentor is using now* — recalled memories, cited docs, active persona (trust signal). **DoD:** rail width = `spring.smooth`; indicator glides; `⌘1..9` switches modules.

### 4.1 Daily Companion (Home)
`display` greeting ("Good morning, Abhay.") + one-line status ("2 meetings · 1 PR · focus: DynamoDB Streams"). **Today's Mission** card = horizontal stepper of 4–5 tasks (1 SQL, 1 system design, 1 review…), each pill fills with Aurora on completion; **streak flame** with count. "Continue where you left off" + "Recent memories learned" rows. Evening variant: "What did you learn today? Save it?" → one-tap memory capture. **DoD:** staggered entrance; mission pills animate fill; keyboard-drivable.

### 4.2 Conversation (Chat)
Center column ~760px. **Suggested-prompt chips** on empty state (never a blank box). **Teaching layout:** answers render as a disclosure ladder — **Hint 1 / Hint 2 / Show approach / Reveal solution** — so the UI embodies teaching. Code blocks in JetBrains Mono with copy + "explain this line." **Streaming:** per-word fade; status pill cycles `thinking → searching docs → drafting` (silence never shown). **Persona chip** (Staff/Interviewer/Teacher…) restyles header accent + tone. **Input bar:** text + mic + `⌘K`; mic hands off to voice without leaving the thread. Right panel: "Context used" — recalled memories + cited sources with confidence markers. **DoD:** 60fps streaming; ladder works; persona switch animates; offline works.

### 4.3 Voice Mode — the showcase (built in Phase 1, Stage 1c)
Full-bleed dark scene, **Orb centered**, nav dims. **Orb (Three.js + GLSL):**
- **Idle:** slow breathing (scale + subtle vertex displacement), Aurora hue drift.
- **Listening:** ripples with live mic amplitude (FFT → vertex displacement), hue → cyan.
- **Thinking:** tighter faster churn, hue → violet, rotating shimmer.
- **Speaking:** pulses with TTS envelope, hue → iris, `--aurora-glow` intensifies.
- **Fallback:** CSS/Canvas orb (radial-gradient + animated blur pulse) for reduced-motion / low-GPU.

Live transcript floats beneath (soft → solid on final). **Barge-in:** user speaks while Orb speaks → TTS ducks, Orb snaps to listening. Controls: push-to-talk hint, wake-word toggle, "tap to interrupt," unobtrusive text fallback. **DoD:** 4 states visually distinct + audio-reactive; barge-in works; 60fps on integrated GPU; fallback triggers under reduced-motion.

### 4.4 Knowledge Memory
Toggle **Graph** / **Profile**. **Graph:** force-directed; nodes = memories colored by type, edges = links; glass tooltip on hover; click focuses node + opens record; search filters/dims. **Profile:** structured "who you are" — Goals, Stack, Strengths, Weaknesses, Reading (% rings), Interview stats in mono tabular with delta sparklines. **Memory card:** title, body, type chip, confidence bar, source, last-updated, linked memories; editable; merge prompts honor upsert-by-similarity. **DoD:** graph smooth at 500+ nodes; tabular figures; deltas animate.

### 4.5 Interview Platform
Launcher: **Coding · System Design · SQL · Behavioral** as gradient-glyph cards. **Coding:** split problem | Monaco editor, minimized Orb interviewer top-right, hint ladder, live eval, ending scorecard. **System Design:** infinite whiteboard (draggable nodes/arrows) + interviewer; capture tradeoffs/scaling. **SQL:** schema panel + query editor + execution-plan/result view. **Behavioral:** conversational voice, STAR hints. **Every session ends with a scorecard that writes back to Memory**, shown visibly ("Profile updated: SQL 92 → 94"). **DoD:** each type playable end-to-end offline; scorecard persists; Orb doesn't steal focus.

### 4.6 Learning Engine (Duolingo for engineers)
Daily mission as a vertical path (locked/current/done nodes), streak header, XP/level, calendar heat-strip. Spaced-repetition review queue. Completing a node → `spring.snappy` fill + subtle particle burst (reduced-motion: plain checkmark). **DoD:** streak/progress persist; path animates; rewarding, not cheap.

### 4.7 Personal Knowledge Base
Library grid of sources (books/blogs/RFCs/PDFs/videos/repos) with type glyph, progress, tags. Drag-and-drop ingest with progress toast. Hybrid search (FTS5 + vector) → unified result list (snippet + source + relevance). Reading view for PDFs/markdown. **DoD:** drag-in → index → searchable offline.

### 4.8 Codebase / Project Mentor
Open repo → tree + **architecture brief** (services, deps, patterns, test/doc coverage) as readable prose, not a file dump. Ask "where is auth?", "where should caching go?" → answers cite `path:line` (clickable). **DoD:** indexes locally; answers cite real locations; explains architecture in prose.

### 4.9 Career Coach
Milestone tracker (→ Staff Engineer) as a progress spine with dimensions (System Design, Leadership, DSA, Communication): current level, gap, trend. Weekly report card; salary/goal tracker; "learning gaps → recommended missions" deep-linking into Learning. **DoD:** data-dense yet calm; tabular figures; numbers from Memory-derived views.

### 4.10 Command Palette (⌘K) & Onboarding
**Palette:** glass overlay, fuzzy search across actions/memories/docs/navigation; arrow-key nav; recent + suggested. Opens <50ms. **Onboarding:** calm 4-step flow — welcome → pull Ollama models (live progress) → download STT/TTS binaries → mic check on the live Orb → "meet your mentor" (captures first identity/goal memories). **DoD:** palette keyboard-only; onboarding shows real progress, ends with a working voice loop.

---

## Part 5 — UI Tech Stack (pin these; they're agent-friendly and you know them well)

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron + Vite + React 18 + TypeScript | one language, mature |
| Styling | Tailwind CSS + CSS variables (Part 3 tokens) | tokens map 1:1 |
| Components | shadcn/ui (Radix primitives) | unstyled, ownable |
| Motion | Motion (`motion/react`) | spring physics, layout animations |
| Orb | Three.js + custom GLSL via react-three-fiber + CSS fallback | GPU, audio-reactive |
| Charts | visx / Recharts for tiles; ECharts only if truly dense | calm, themeable |
| Graph | react-force-graph / Sigma.js | force-directed, performant |
| Editor | Monaco | coding/SQL |
| Icons | Lucide | one set |
| State | Zustand | simple, fast |
| Fonts | Inter var + JetBrains Mono var (+ optional Instrument Serif), **bundled locally** | offline-first |

> 2026 note: Radix is in light maintenance; shadcn/ui still ships on it and is fine to adopt. If a primitive misbehaves, **Base UI** or **React Aria** are drop-in escape hatches — don't block on it.

**Frontend structure**
```
apps/desktop/src/renderer/
  app/     # one folder per Part-4 screen
  ui/      # design-system primitives (Button, Card, Chip, Keycap, Panel, Toast, Overlay…)
  orb/     # Three.js orb + shaders + CSS fallback
  motion/  # spring presets, variants
  theme/   # tokens.css, ThemeProvider, dark/light
  lib/     # coreClient.ts (typed IPC/HTTP), hooks, zustand stores
```

---

## Part 6 — The Phased Build Plan (you drive this; STOP at each gate)

> **How to run this:** do one phase, self-verify (§0.2), update `PROGRESS.md`, then follow **The Check-in Protocol (§0.4)** — show screenshots, summarize, and **wait for the user's input before the next phase.** Each phase is a vertical slice that leaves the app runnable.

### ▸ Phase 1 — First Win: the Voice + Orb magic moment *(Ultra)* ← **the first thing we want**
**Goal:** go from nothing to a premium app where you **talk hands-free to a living Orb and get spoken, teaching-style answers from a local model — fully offline.** This is the full "wow," and it's the first thing delivered.

This is a large phase. Build it as **three internal stages**, self-verifying each, but there is a **single hard check-in at the very end** (plus one optional early look so design drift is caught before everything is built on it).

**Stage 1a — Foundation & design system.** Scaffold Electron+Vite+React+Tailwind+TS monorepo; wire Part-3 tokens into `theme/tokens.css` + Tailwind; build the **UI primitive kit** (`ui/`: Button, Card, Chip, Keycap, Panel, Toast, glass Overlay) with dark-first spring states; build the **app shell** (§4.0: rail + animated active indicator + right context panel) and the **`⌘K` palette skeleton**; set up `lib/coreClient.ts` and `ThemeProvider` (dark/light). Produce a **token/primitive showcase page** proving every primitive in all states.
> *Optional early look (recommended, not a hard stop):* show the showcase + empty shell for a quick gut-check — *does it already feel Linear/Raycast-tier?* — before building on it.

**Stage 1b — Local chat (teaching posture).** Conversation screen (§4.2) with the disclosure ladder, persona chip, suggested prompts, per-word streaming, "Context used" panel; wire **Ollama** via `coreClient` for real streaming; graceful "Ollama offline / model not pulled" states; local SQLite for chat threads.

**Stage 1c — Voice Mode + Orb (the magic).** Voice Mode (§4.3); shader Orb with 4 states + CSS fallback; whisper.cpp sidecar (mic → streaming transcript); Piper TTS; global push-to-talk hotkey + tray; **barge-in**; hook voice into the same chat/persona pipeline from 1b.

**Self-verify (whole phase):** shell renders dark & light, rail springs, palette <50ms, console clean; chat streams at 60fps with hints-before-solution and a clean "Ollama offline" degraded state; hold-to-talk → transcript → hints-first spoken answer → talk over it → Orb ducks & listens; 4 Orb states visually distinct + audio-reactive; 60fps on integrated GPU; **works with network off**; reduced-motion → fallback orb; every empty/loading/error state designed.
**STOP & CHECK-IN:** live demo of the full magic loop. This is the soul of the product — get explicit approval on how it **looks and feels** before building any data modules.

### ▸ Phase 2 — The Differentiator: Knowledge Memory *(Extra)*
**Goal:** it remembers you and recalls without re-asking.
**Build:** Memory Profile + Memory cards; SQLite memory records + embeddings (LanceDB); **upsert-by-similarity** de-dupe; recall injected into chat context; Memory Graph (force-directed, §4.4); "Save this?" capture flow.
**Self-verify:** state a goal/weakness → persists → recalled next session → repeating it updates the same record (no duplicate); graph smooth at 500+ nodes.
**STOP & CHECK-IN:** show memory persisting and de-duping across a restart.

### ▸ Phase 3 — Daily Loop: Home + Learning Engine *(Extra)*
**Build:** Daily Companion home (§4.1) with mission stepper + streak; Learning Engine (§4.6) path + spaced repetition + heat-strip; wire missions to Memory/Career.
**Self-verify:** streak/progress persist; mission completion animates; evening capture writes a memory.
**STOP & CHECK-IN:** show a full "morning briefing → do a mission → evening capture" loop.

### ▸ Phase 4 — Knowledge Base + Hybrid Search *(Medium)*
**Build:** KB library (§4.7); drag-drop ingest (PDF/MD/DOCX/txt) → chunk → embed → LanceDB + FTS5; hybrid search service; chat can ground answers on indexed docs (RAG) + cite them.
**Self-verify:** drag in a PDF → ask a doc-only question → grounded, cited answer with network off.
**STOP & CHECK-IN:** demo offline RAG over a real document.

### ▸ Phase 5 — Interview Platform *(Extra; build one type per check-in)*
**Build (in order, stopping between each):** Coding → SQL → System Design → Behavioral (§4.5). Each ends with a scorecard that writes back to Memory.
**Self-verify per type:** playable end-to-end offline; scorecard persists; Orb interviewer integrated without stealing focus.
**STOP & CHECK-IN after each type.**

### ▸ Phase 6 — Codebase Mentor + Career Dashboard *(Extra)*
**Build:** Codebase Mentor (§4.8) repo indexing + architecture brief + cited answers; Career Coach dashboard (§4.9) from Memory-derived views.
**Self-verify:** answers cite real `path:line`; dashboard is data-dense yet calm.
**STOP & CHECK-IN.**

### ▸ Phase 7 — Polish, Ownership & Optional Cloud *(mixed)*
**Build:** Onboarding (§4.10), Settings, backup/export (portable data folder), cloud-router opt-in (real Claude/GPT adapters — look up current model IDs/pricing), full reduced-motion + accessibility audit, performance pass against §7 budgets.
**Self-verify:** run the full Part-8 verification suite.
**STOP & CHECK-IN:** ship-readiness review.

---

## Part 7 — Quality Bars (global Definition of Done)

**Performance:** sustained **60fps** for all motion + Orb (measure on integrated GPU); animate only `transform`/`opacity`; Orb on GPU off main thread; palette <50ms; first local token <1.5s warm; fonts/binaries bundled locally — **no external CDN/network for UI assets**.

**Accessibility:** full keyboard operability; visible `--focus` ring; AA contrast (verify body on each surface); `prefers-reduced-motion` fully honored (springs→fades, Orb freezes); SR labels on all controls; voice mode has a text-equivalent path.

**Per-screen craft checklist:** empty state designed · loading uses status cues not silent spinners · errors offer a next action · **dark AND light both intentional** · spring on entrance + state change · shortcut wired into `⌘K` · **you ran vision self-verification and it matched §3.0**.

**Behavioral correctness:** mentor defaults to hints/questions; full solution only on explicit "Reveal"; cloud never called without opt-in; data stays local unless synced.

---

## Part 8 — Verification (prove it end-to-end)
1. **Feel test:** empty shell already looks premium (surface ladder, animated rail, glass palette).
2. **The magic loop:** Voice Mode → hold-to-talk → "Explain DynamoDB GSIs" → correct transcript → **hints-first** spoken answer → talk over it → Orb ducks & listens. 60fps. Repeat **network off** — still works.
3. **Memory:** "goal = Staff Engineer, weak at graphs" → save → restart → "what are my weaknesses?" recalled, no duplicate on repeat.
4. **Teaching posture:** a LeetCode-style ask shows Hint 1/2/approach before any solution; solution only on Reveal.
5. **RAG offline:** drag PDF → doc-only question → grounded, cited answer, network off.
6. **Ownership:** export → single portable data folder has everything.
7. **Reduced motion & light theme:** toggle both — nothing breaks, both deliberate.
8. **Ship criterion:** the author uses it daily for a week instead of a browser chatbot.

---

## Part 9 — Seed Data (use this everywhere; never lorem ipsum)
Populate every screen with this realistic profile so your vision self-verification has real targets:

- **Identity:** Abhay — SDE3, backend-leaning. **Goal:** reach **Staff Engineer**.
- **Current stack:** AWS · Node · React · DynamoDB · Datadog.
- **Strengths:** System Design, Backend, Leadership. **Weaknesses:** Graphs, Dynamic Programming, Networking.
- **Reading:** *Designing Data-Intensive Applications* — 70% complete.
- **Interview history:** 132 interviews. **Scores:** SQL 92 · Architecture 84 · Behavioral 95.
- **Sample missions:** "One SQL optimization question," "One system-design review (URL shortener scaling)," "One architecture review," "One AWS question (DynamoDB Streams)," "One code review."
- **Sample personas to demo:** Staff Engineer, Interviewer, Teacher, Architect.
- **Career dimensions (for dashboard):** System Design 84 · Leadership 90 · DSA 68 · Communication 88 → milestone: Staff Engineer.

---

## Appendix — Research basis (why these decisions)
Tailored to **Fable 5's** strengths (SOTA UI generation, holds a design system across screens, vision self-verification, 1M-context agentic multi-day runs) and to 2026 UI craft:
- Fable 5 UI tactics — design-system-first, realistic data, explicit states, reference real apps, vision self-verify: [Fable 5 for UI design](https://www.griffinwooldridge.com/blog/claude-fable-5-for-ui-design-how-to-get-beautiful-output-every-time), [Fable 5 coding/design impressions](https://clankercloud.ai/blog/claude-fable-5-coding-design-impressions-clanker-cloud), [Fable 5 overview](https://www.anthropic.com/news/claude-fable-5-mythos-5)
- Handoff-spec structure — tokens registry, component structure, vertical slices, progress log, gates: [Claude design-to-code handoff](https://claudefa.st/blog/guide/mechanics/claude-design-handoff), [effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Dark-first surface-ladder discipline, monochrome chrome, glass palette: [Raycast design system](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md)
- Spring-physics motion for a human, premium feel: [Motion / spring physics](https://www.framer.com/dictionary/framer-motion)
- Conversational-UI patterns — never blank, show activity, clarifying failure, trust markers: [AI UX conversational patterns](https://www.aiuxdesign.guide/patterns/conversational-ui)
- Voice-reactive Orb (Idle/Listening/Thinking/Speaking via Three.js + GLSL, audio-reactive): [voice-reactive orb in React](https://medium.com/@therealmilesjackson/building-a-voice-reactive-orb-in-react-audio-visualization-for-voice-assistants-2bee12797b93)
- 2026 trends — dark-mode default, glassmorphism-with-depth, cool neutrals, variable fonts, calm over theatrics: [UI trends 2026](https://lucky.graphics/learn/ui-design-trends-2026/), [color trends 2026](https://www.recursion.agency/blog/ui-color-trends-2026)
- Stack — shadcn/ui + Radix + Motion as the agent-friendly path: [React component libraries 2026](https://www.untitledui.com/blog/react-component-libraries), [Tauri/shadcn starter](https://github.com/agmmnn/tauri-ui)
- Memory graph — force-directed React visualization: [React graph visualization guide](https://cambridge-intelligence.com/blog/react-graph-visualization-library/)
