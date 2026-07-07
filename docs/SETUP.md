# MentorOS — setting up on a new machine

Target platform: **macOS on Apple silicon** (M-series). The Electron app itself
is cross-platform, but the local AI stack (whisper.cpp Metal, Kokoro via the
x86_64-wheel venv trick, MLX image gen) and the `postinstall` arm64 rebuild are
tuned for Apple silicon — treat other platforms as unsupported for now.

## 1. Prerequisites

| tool | why | install |
| --- | --- | --- |
| Xcode Command Line Tools | compilers for native modules + whisper build | `xcode-select --install` |
| nvm + Node 22 | repo pins Node ≥22 (`.nvmrc` = 22; dev machine uses v22.16.0) | `nvm install 22 && nvm use 22` |
| pnpm 9 via corepack | `packageManager: pnpm@9.1.0` | `corepack enable` (ships with Node) |
| Ollama | local LLM + embeddings | `brew install --cask ollama` (or ollama.com), then open the app once |
| cmake (optional) | only needed if no Homebrew `whisper-cli`; the app builds whisper.cpp from source on first voice use | `brew install cmake` |

Pull the local models the core expects:

```bash
ollama pull llama3.1:8b        # default chat/interviewer/judge model
ollama pull nomic-embed-text   # 768-dim embeddings for memory + KB search
```

> Watch out: if the machine's default `node` is ancient (dev machine's was
> v12), always `export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"`
> in scripts/CI shells that don't source your profile.

## 2. Clone + install + run

```bash
git clone <repo-url> mentoros && cd mentoros
nvm use                # picks up .nvmrc
corepack enable
pnpm install           # postinstall runs electron-rebuild for better-sqlite3 (arm64)
pnpm dev               # electron-vite dev; core server self-starts on port 4820+
```

Verification: `pnpm --filter @mentoros/desktop typecheck` and
`pnpm --filter @mentoros/desktop test` should both pass green.

Notes:
- **better-sqlite3 must be arm64.** The `postinstall` script pins
  `electron-rebuild -f -w better-sqlite3 --arch arm64` because an nvm node
  running under Rosetta would otherwise build x86_64 against an arm64 Electron.
- The core Fastify server runs **in-process** in Electron main, scanning up
  from port 4820; the renderer discovers it via a `?corePort=` query param.
  Nothing to configure.
- CDP screenshots / driving the app headlessly:
  `pnpm --filter @mentoros/desktop dev -- --remote-debugging-port=9222`
  (note the single `--`).

## 3. First-run provisioning (automatic)

On first use of the Voice screen the core **self-provisions** everything under
the Electron data dir (`~/Library/Application Support/@mentoros/desktop/data`):

- whisper.cpp binary — found on brew PATH (`whisper-cli`) or **built from
  source** into `data/voice/bin` (needs cmake + CLT),
- whisper model `ggml-small.en.bin` (~466MB) into `data/voice/models`
  (higher-quality `medium.en` / `large-v3-turbo` are downloaded on demand from
  Settings → Voice),
- Kokoro TTS: `kokoro-v1.0.onnx` + `voices-v1.0.bin` into `data/voice/kokoro`,
  plus a python venv at `data/venv-tts` (uses an x86_64 python for onnxruntime
  wheel availability — handled automatically).

Expect a one-time ~7s Metal shader compile on the first whisper call, and a
macOS microphone permission prompt. `⌥Space` global push-to-talk may need
Accessibility permission.

Cloud models (optional): Settings → Models → paste an Anthropic API key.
Local llama3.1 is the fallback whenever cloud is unusable.

## 4. Migrating your data from the old machine

All state lives in one folder. Quit the app on both machines, then copy:

```
~/Library/Application Support/@mentoros/desktop/data
```

(≈1.4GB incl. voice models; the SQLite DB inside holds memory, chat history,
KB index, interview records, settings. API keys live in the settings table —
copy the folder and they come along.)

Also on the dev machine (import sources + asset pipeline, not required to run):
- `~/Documents/abhay/3-month-challenge/` and `~/Documents/abhay/interview-prep/`
  — the real-data import sources (plan/memory imports re-run idempotently).
- `~/mentoros-imagegen/` (~20GB) — local image-gen toolchain for face presets;
  see `docs/IMAGEGEN.md`. Only needed to generate new presets; the app ships
  with the generated WebP assets in the repo.

## 5. Agent workflow (if using Claude Code on the new machine)

Read `CLAUDE.md` → `PROGRESS.md` → `plan.md` in that order. `PROGRESS.md`
carries the exact resume state; `plan.md` is the read-only spec.
