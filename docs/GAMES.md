# Learning games — research + scoped proposal (NOT built)

> Research snapshot 2026-07-15 (session 8). Deep-research summary + a phased,
> scoped plan for in-app learning games playable from the laptop **and the
> phone browser** (LAN/Tailscale path already shipped — see docs/MOBILE.md),
> solo or 2-player against the same core. Awaiting user approval of scope and
> phase order before anything is built.

## Why games, in one paragraph (learning science)

The mechanics with real evidence behind them: **retrieval practice** (actively
recalling beats re-reading, ~+25% retention), **spacing** (wrong answers should
resurface later — we already have a review queue), **interleaving** (mixed
topics in one session transfer better than blocked drilling), and
**explaining-to-learn** (Feynman; ~0.55 SD gain in meta-analyses). Time
pressure helps when framed as *challenge* (speed bonus) and hurts when framed
as *threat* (harsh fail states) — so score speed, never punish slowness.
Competition/leaderboards mainly buy engagement (Duolingo/Kahoot report large
retention-of-habit effects), not retention of material — the duel is the sugar,
the retrieval is the medicine.

## What the market does (compressed findings)

| Format | Exemplar | Loop | Session | Phone fit |
|---|---|---|---|---|
| Speed quiz w/ live leaderboard | Kahoot | tap 1-of-4, speed×correct scoring | 2–5 min | ★★★ tap-only |
| Retrieval battle | Anki-style duels | timed card recall, alternating | 2–5 min | ★★★ |
| Code duels | CodinGame Clash of Code | fastest / shortest / **reverse** (deduce spec from I/O) | <5 min | ★ needs editor |
| Rank ladder | Codewars kyu/dan | async kata + rank | 10–30 min | ★★ |
| Typing race | TypeRacer | WPM race on a passage | 1–2 min | ★ |
| Puzzle progression | Flexbox Froggy / SQL Murder Mystery | narrative/level unlocks | 5–60 min | ★★ |
| Habit wrapper | Duolingo leagues | weekly XP cohort, streaks | 3–15 min/day | ★★★ |

LLM-judged formats seen in the wild / obviously buildable with our router:
**spot the bug**, **predict the output**, **Big-O guessing**, **system-design
card picks judged on trade-offs**, **estimate-the-number** (latency/QPS Fermi),
**explain-it-in-60s** graded on a rubric.

Multiplayer plumbing for our case is small: authoritative game state in core,
one in-memory room registry, WS events (we already broadcast typed events over
/events with LAN token auth), delta updates, and a rejoin grace window. Two
clients = the laptop and the phone on the same core; a friend over Tailscale
works identically.

## What we'd build on (already shipped)

- **Phone access**: renderer served from core + token (docs/MOBILE.md) — a
  second player is just another browser tab on :4820.
- **XP/level/streak/quests engine** (`core/learning/xp.ts`) — games award XP
  through the same summary pipeline; quests can say "win a duel".
- **KB with tagged study guides** (week/topic tags, FTS5) — question source.
- **Review queue** — wrong answers can be fed back as due items (spacing).
- **LLM router + surfaces** (local llama, org gateway, OpenCode Zen) — a
  `games` surface for question generation/judging, same pattern as `guide`.
- **Monaco + test runner** (practice mode) — code-round games on the laptop.
- **Voice stack** (whisper STT) — speak your Explain-in-60s answer.

## Proposed games (ranked)

1. **Recall Sprint / Recall Duel** — the anchor game. 10 questions, 1-of-4
   tap answers, 20s each, speed-weighted scoring. Questions come from a
   pre-generated bank derived from *your* study guides (per topic/week), so a
   sprint on "Week 4 · graphs" is retrieval practice on exactly what you read.
   Solo first; duel = same questions, same clock, live opponent score. Wrong
   answers → review queue. Phone-perfect.
2. **Predict the Output / Spot the Bug** — same round engine, question kinds
   that show a short code snippet (rendered read-only, no editor needed) with
   4 candidate outputs / 4 candidate bug lines. LLM-generated offline into the
   bank, validated by actually executing the snippet with the existing runner
   (deterministic ground truth — the LLM can't grade wrong).
3. **Big-O Blitz** — snippet → pick complexity from a fixed chip row
   (O(1)…O(2^n)). Partly hand-authored seed deck, partly generated+verified.
   1–2 min rounds, ideal phone filler.
4. **Latency Ladder** (estimation) — order 4 operations by cost / pick the
   right magnitude ("L1 ref vs mutex vs SSD read vs cross-DC RTT", Postgres
   QPS, Kafka throughput). Hand-authored seed deck (~100 cards) from the
   classic latency numbers + our Postgres/devops guides. Drag-to-order works
   on touch.
5. **Explain-in-60s** (Feynman) — app names a topic from your KB ("explain
   LRU eviction trade-offs"), you talk (whisper) or type for 60s, LLM judges
   against a rubric (correct / complete / clear) with the guide part as
   reference context, returns 3-line feedback + a score. Weak topics get
   flagged into the review queue. Highest learning value per minute; solo.
6. *(later, laptop-only)* **Reverse Clash** — given 3 input→output pairs,
   write the function in Monaco, hidden tests confirm. Reuses practice mode
   almost wholesale, but it's a desk game — lowest priority for the
   phone goal.

Deliberately rejected: TypeRacer-style code typing (no interview signal),
public leaderboards/league infra (n=1 user; streaks + personal bests give the
same pull without cohort plumbing), and live-LLM question generation *during*
a round (local-model latency would wreck pacing — generate into a bank ahead
of time instead).

## Architecture sketch

- `core/games/`: additive SQLite tables `game_questions` (kind, topic tags,
  payload JSON, provenance, verified flag), `game_runs` (solo results),
  `game_rooms` in-memory only. Deck builder = LLM (router `games` surface)
  fed guide markdown per topic → question JSON → **verified before insert**
  (code kinds executed via runner; MCQs schema-checked, duplicates FTS-matched).
  Seed decks for Big-O + Latency Ladder are hand-authored (realistic data
  rule, plan.md Part 9).
- Rounds are server-authoritative: core deals questions, stamps deadlines,
  scores answers, broadcasts `game.state` deltas over the existing WS; clients
  only render + send taps. Reconnect = replay current round state (the WS
  reconciliation lesson from the import-progress bug applies here).
- Duel rooms: create → 6-char join code shown as URL/QR (phone already has a
  tokenized URL path); 5s rejoin grace; forfeit after.
- Renderer: one new **Arcade** screen (rail + More sheet), game shell =
  question card + answer grid + tick clock + end-of-run recap (score, XP,
  "3 added to review"). Nocturne invariants apply; XP juice reuses the
  learning toast path.
- XP: fixed per-game awards through the existing engine, with a **daily games
  XP cap** so grinding sprints can't out-earn the actual plan.

## Phasing (each = one session-ish, gated per §0.4)

- **GAME-A — bank + Recall Sprint (solo)**: games tables, deck builder for MCQ
  recall from study guides, Arcade screen w/ one game, XP + review-queue
  wiring. *Proves the whole loop end-to-end.*
- **GAME-B — duel**: room registry + WS protocol + join-by-code/QR, Recall
  Duel using GAME-A's decks, laptop↔phone verified over LAN.
- **GAME-C — code-reading kinds**: Predict Output + Spot the Bug (+ Big-O
  Blitz seed deck) as new question kinds in the same engine, runner-verified
  generation.
- **GAME-D — judged + estimation**: Explain-in-60s (voice/typed, LLM rubric
  judge) + Latency Ladder deck w/ drag-to-order.

## Open decisions (user)

1. Phase order OK? (A→B→C→D; B before C maximizes the "play with someone"
   ask, C before B maximizes solo variety.)
2. Question generation surface: local llama (free, slower/noisier — but
   verification catches bad code questions) vs an endpoint model (better
   distractors). Default proposal: endpoint when configured, local fallback.
3. Arcade placement: own rail destination (proposed) vs a tab inside Learning.
4. Daily games XP cap value (proposal: 300/day).
