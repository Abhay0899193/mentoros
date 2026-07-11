# Disk layout — where MentorOS data lives on this machine

> Running findings doc. Whenever a session researches "where does X live" or
> digs up machine-local facts worth keeping, they get appended here.

## App runtime data (userData)

Everything the running app reads/writes lives under
**`~/Library/Application Support/@mentoros/desktop/`** (note: `@mentoros`,
not "MentorOS" — Electron uses the package scope as the folder name).

| Path (under `…/@mentoros/desktop/`) | What it is |
|---|---|
| `data/mentoros.db` | The SQLite DB — chats, memory, `face_presets` rows (avatar configs), Image Lab job history |
| `data/faces/<preset>/` | Final avatar preset frames (webp): `face-kiki`, `face-maya`, `face-siri`, `face-siri-2`, `face-test2` (~10 MB total) |
| `data/imagegen/` | Image Lab output — one `<uuid>.png` per finished job; `.tmp/` holds decoded reference images for edit models |
| `data/voice/`, `data/venv-tts/` | Voice assets and the TTS python venv |
| everything else (`Cache/`, `GPUCache/`, `Code Cache/`, …) | Chromium cruft, safe to ignore |

Resolved in code: `apps/desktop/src/main/index.ts` →
`startCore({ dataDir: join(app.getPath("userData"), "data") })`;
Image Lab paths in `apps/desktop/src/core/imagegen/paths.ts`.

## Offline image-generation workspace (NOT in the repo, NOT in userData)

**`~/mentoros-imagegen/`** — the machine-local toolchain used to generate
face presets offline (see `docs/IMAGEGEN.md` for the how-to):

| Path | What it is |
|---|---|
| `hf-cache/` | **~25 GB** — HuggingFace weights: Z-Image-Turbo 4-bit + FLUX.1-Kontext-dev 4-bit. Only thing worth deleting to reclaim disk; re-downloads on demand |
| `out/<id>/` | Raw generation output per model (~81 MB): `portrait-base.png`, `kontext-*.png` variants, staged `art/` webps before they're copied into userData |
| `logs/` | Generation scripts + logs from the Kiki preset build: `gen_kiki.sh`, `gen_variants.sh`, `finalize_kiki.py` (anti-drift composite), `kiki_regions.json` (mouth/eyes/face ellipses), `insert_kiki.sh` (~100 KB). **These do not exist anywhere else** — repo copies live in `tools/faces/` only for the older lena/sienna/kira pipeline |
| `smoke/` | Toolchain smoke-test renders |
| `USAGE.md` | Machine-local toolchain notes |

## Repo-side asset locations

- `tools/faces/` — committed asset-pipeline scripts (`composite_variants.py`,
  `make_masks.py`, `PROMPTS.md`) for the original built-in presets.
- `apps/desktop/src/renderer/orb/faces/art/<id>/` — the built-in presets'
  webp frames, bundled with the app.
- `img/` — ad-hoc screenshots/reference images (untracked scratch).
