# Models — landscape, comparison, and how to plug providers into MentorOS

> Research snapshot **2026-07-15**. Model quality/pricing moves fast — re-verify before big decisions.
> How routing works in-app: Settings → Models has one picker per surface (Chat, Voice,
> Interviewer, Scorecard, Guide writer). Cloud/endpoint choices silently fall back to the
> local default when unusable (cloud off, missing key/endpoint).

## 1 · Ways to get a model into MentorOS

| Source | How | Notes |
|---|---|---|
| **Ollama (local)** | Just `ollama pull <tag>` — appears in every picker automatically | Private, free, offline; quality capped by what fits in 24 GB |
| **Anthropic API** | Settings → Models → API key from **console.anthropic.com** | Requires a real API key (`sk-ant-api03-…`) with billing |
| **Custom endpoint — Anthropic-compatible** | Settings → Models → Custom endpoints → kind *Anthropic*, base URL + bearer token | Covers corporate Claude gateways (e.g. an org proxy configured via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`); model id is whatever the gateway routes (e.g. `Auto-MoM`) |
| **Custom endpoint — OpenAI-compatible** | kind *OpenAI*, base URL + key | Covers OpenCode Zen, OpenRouter, LM Studio, llama.cpp server, vLLM… anything speaking `/chat/completions` |

**Claude Code subscription ≠ API access.** A Claude Pro/Max login (Google OAuth in Claude
Code, token prefix `sk-ant-oat01`) only works for Claude Code / claude.ai — Anthropic's API
rejects it and using it in third-party apps violates the consumer ToS. To use Claude inside
MentorOS you need either a console API key or an org gateway added as a custom endpoint.

**OpenCode Zen** (the gateway inside the `opencode` CLI) is a plain OpenAI-compatible API:
base URL `https://opencode.ai/zen/v1`, key from the opencode.ai dashboard (free account).
Free tier ≈ 100 requests/day; free-tier prompts **may be used for training** (fine for
study-guide generation, think twice for anything personal). The free models also rotate —
"limited-time" entries appear and disappear.

## 2 · The models, compared

Reference points: Claude **Opus 4.8** (~80.8% SWE-bench, $5/$25 per MTok), **Sonnet 5**
(~79% SWE, $3/$15), **Haiku 4.5** (~73% SWE, $1/$5).

### Local (Ollama on the M4 Pro 24 GB)

| Model | Verdict | Good at | Weak at |
|---|---|---|---|
| `qwen3:8b` | **Best local all-rounder** — top open ~8B coder | Code drafts, short structured JSON | Long-prompt instruction following; well below Haiku |
| `qwen3:4b` | Surprisingly capable for 4B; fastest | Quick classification, short answers | Anything long or subtle |
| `llama3.1:8b` | Better *instruction-following* than Qwen, weaker code | Conversational surfaces, steady JSON | Coding depth; showing its age (3.3-era distills beat it) |
| `mistral:7b` | Outclassed by both above | — | Weakest of the four; fine to drop |

All four sit clearly **below Haiku 4.5** on every axis. They're the privacy/offline tier,
not the quality tier. Rough local pecking order: `qwen3:8b` > `llama3.1:8b` ≈ `qwen3:4b` > `mistral:7b`.

### OpenCode Zen free tier

| Model | What it is | Verdict |
|---|---|---|
| **Big Pickle** | Stealth frontier preview (community consensus: DeepSeek family) | **Best free option** — agentic-coding oriented, large context; limited-time |
| **DeepSeek V4 Flash Free** | DeepSeek's fast tier | Strong for its speed (~Sonnet-4.6-ish on structured work); explicit data-training caveat |
| **Hy3 Free** | Tencent Hunyuan 3 (295B MoE / 21B active, 256K ctx) | Competitive coder, big context |
| **Nemotron 3 Ultra Free** | NVIDIA Nemotron 3 | Solid, less coding-specialized |
| **MiMo V2.5 Free** | Xiaomi MiMo | Light tasks only |
| **North Mini Code Free** | Unknown proprietary | Unproven — treat as experimental |

Best free picks (Big Pickle, DeepSeek V4 Flash, Hy3) land **between Haiku 4.5 and Sonnet 5**
for coding-ish work — i.e. far better than anything local — at $0, with the rate-limit and
data-training caveats above.

### Rough overall tiers (coding + structured output + long-prompt obedience)

```
Opus 4.8 / Fable-class        ─ frontier
Sonnet 5                      ─ near-frontier, cheap enough for daily surfaces
Big Pickle · DeepSeek V4 Flash · Hy3   ─ free-cloud sweet spot
Haiku 4.5                     ─ fast/cheap paid floor
qwen3:8b · llama3.1:8b        ─ local/private floor
qwen3:4b · mistral:7b         ─ only when speed/RAM demands it
```

## 3 · Suggested per-surface routing

| Surface | Suggestion | Why |
|---|---|---|
| Chat / Voice | Local `qwen3:8b` day-to-day; endpoint model when quality matters | Latency + privacy matter most |
| Interviewer | Sonnet-class or better (org gateway / Zen Big Pickle) | Dialogue quality is the product |
| Scorecard | **Strongest model you have** — also drives LeetCode imports | Draft/grading quality is bounded by this surface |
| Guide writer | Strongest available (Opus/Sonnet via gateway, else Big Pickle) | 250-line structured markdown to the RULES.md bar — small models drift |

The memory merge-judge deliberately stays local (latency-sensitive classifier).
