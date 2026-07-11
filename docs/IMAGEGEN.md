# Local image generation — how it works, setup from scratch, alternatives

This powers the **realistic mentor face presets** (lena / sienna / kira in
Settings → Identity). It is an offline, one-time asset pipeline — the app
never runs image generation at runtime; it plays back pre-generated stills.

## How the whole thing works

1. **Base stills** — a text-to-image model (FLUX.1-schnell, 4-bit, running
   locally via MLX) renders each preset once: a 1024×1024 head-and-shoulders
   portrait (mouth closed, eyes open) and an 832×1216 full-body shot.
2. **Variant frames** — an instruction-editing model (FLUX.1-Kontext-dev,
   4-bit) takes the portrait and applies one edit per frame: lips slightly
   parted (m1), mouth open mid-speech (m2), mouth wide (m3), eyes closed
   (blink). Kontext preserves the person's identity while making the edit.
3. **Anti-drift compositing** — Kontext output isn't pixel-identical outside
   the edit, so `tools/faces/composite_variants.py` pastes only a feathered
   ellipse (mouth / eye region) from each edit back onto the base. Everything
   outside that ellipse is byte-for-byte the base frame.
4. **WebP + playback** — frames go through `cwebp -q 82` into
   `apps/desktop/src/renderer/orb/faces/art/<id>/`. At runtime
   `RealisticPortrait.tsx` stacks the 5 portrait frames and lip-syncs by
   switching frame opacity from the live TTS loudness envelope (sqrt curve,
   fast attack / slow release), plus autonomous blinks. So "talking" is just
   opacity flips between pixel-aligned stills — 60fps cheap, fully offline.

Full generation spec (prompts, seeds, judged re-roll rules):
`tools/faces/PROMPTS.md`. Machine-local toolchain doc: `~/mentoros-imagegen/USAGE.md`.

## Set up the toolchain from scratch (new machine)

Requirements: Apple-silicon Mac, ~24GB RAM (peak MLX usage ≈ 19GB), ~20GB disk.

```bash
# 1. uv (python tool manager), then mflux — MLX image-gen CLI
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install mflux            # installs mflux-generate* into ~/.local/bin

# 2. Dedicated model cache (keep it out of ~/.cache; ~17GB for both models)
mkdir -p ~/mentoros-imagegen/hf-cache
export HF_HOME="$HOME/mentoros-imagegen/hf-cache"
export HF_HUB_DISABLE_XET=1      # Xet backend hangs silently — always disable
export HF_HUB_DOWNLOAD_TIMEOUT=30

# 3. Models download automatically on first use (resumable). First runs:
mflux-generate --model dhairyashil/FLUX.1-schnell-mflux-4bit --base-model schnell \
  --prompt "head and shoulders portrait of a woman, soft cinematic key light, photorealistic" \
  --steps 4 --seed 42 --width 1024 --height 1024 --output smoke.png
```

## Using it directly (generate any image)

Text → image (~65–80s at 1024², ~16s/step, schnell needs only 4 steps):

```bash
mflux-generate --model dhairyashil/FLUX.1-schnell-mflux-4bit --base-model schnell \
  --prompt "your prompt here" --steps 4 --seed 7 --width 1024 --height 1024 --output out.png
```

Edit an existing image by instruction (~10 min at 1024², 16 steps):

```bash
mflux-generate-kontext --model akx/FLUX.1-Kontext-dev-mflux-4bit --base-model dev \
  --image-path in.png --prompt "Make her jacket red." \
  --steps 16 --guidance 4.0 --seed 7 --width 1024 --height 1024 --output out.png
```

Prompt lessons we paid for (probe-tested):
- **Kontext ignores timid edits.** guidance 2.5 + "keep everything exactly the
  same" → the output is the input. Use guidance ≈4.0, put the action first
  ("Open her mouth wide as if speaking…"), skip keep-same clauses — identity
  preservation is Kontext's default behavior.
- Very subtle edits ("lips slightly parted") can still no-op; going the other
  direction (edit the open-mouth frame to *mostly close*) detects better.
- schnell framing drifts: "85mm lens, shallow depth of field" biases crops to
  thigh/shin on full-body shots — say "entire body visible from head to shoes,
  standing on a dark studio floor" and "50mm lens, full-length fashion
  photography". Iterate seed ±1..5 and judge; renders are cheap.
- Batch scripts for our pipeline live in `~/mentoros-imagegen/logs/`
  (gen_bases.sh, gen_variants.sh, composite_all.sh) — skip-if-exists, safe to
  re-run after interruption.

## Why these models — and the alternatives

Chosen: **mflux (MLX) + FLUX.1-schnell 4-bit + FLUX.1-Kontext-dev 4-bit**
- fully offline (project invariant: local-first), zero per-image cost
- MLX is Apple-silicon-native — much faster than PyTorch/MPS diffusers here
- 4-bit quants fit the 24GB machine (peak ~19GB) and the ~20GB disk budget
- schnell is 4-step fast; Kontext gives identity-preserving edits **without
  masks/inpainting** (the 4-bit Fill-dev we originally planned doesn't exist
  as an mflux quant, and full Fill-dev is 33GB + gated)
- licenses: schnell = Apache-2.0 (clean); Kontext-dev = BFL non-commercial
  license — fine for personal use; revisit if MentorOS ever ships commercially.

Alternatives, when to prefer them:
| option | trade-off |
| --- | --- |
| **Draw Things** (Mac app) | easiest GUI for the same local models; not scriptable enough for our batch pipeline |
| **ComfyUI** | node-graph power tool (ControlNet, IPAdapter face-lock, upscalers); heavier setup, python env churn — overkill for a one-time 18-image pipeline |
| **mflux's other models** (`Qwen-Image`, FLUX.2-klein) | more options in the same CLI. **z-image-turbo was tested and adopted** — it now powers Image Lab and the Preset Generator (8 steps, ~2 min at 1024², and its same-seed t2i recipe replaced Kontext edits for text-born presets) |
| **Cloud APIs** (BFL FLUX 1.1 Pro / Kontext Pro, fal.ai, Replicate, gpt-image-1) | clearly better quality + seconds-fast, ~$0.03–0.07/image, but online + paid — wrong default for a local-first app; could become an *optional* path once cloud keys are in Settings anyway |
| **True talking-head ML** (LivePortrait, SadTalker et al.) | real lip-sync from audio, but heavy video models, GPU-hungry, not sensibly offline on this machine — this is exactly why we do sprite-stack lip-sync over stills |

## In-app generation UI (shipped — Avatar Studio)

Two in-app surfaces now drive the toolchain (both fire-and-forget background
jobs with WS progress, one at a time — faces and Image Lab jobs block each
other since either spawns mflux at ~11GB peak):

1. **Image Lab** (Avatar Studio → Image Lab pill) — free-form text-to-image
   playground. Local backend = **Z-Image-Turbo** (pre-quantized
   `filipstrand/Z-Image-Turbo-mflux-4bit`, ~6GB, 8 steps, ~2 min at 1024²),
   plus hosted z-image-turbo via fal.ai and Kontext edit-from-photo. History
   in SQLite, server-resolved seeds.
2. **Preset Generator** (Avatar Studio → "Generate a preset") — the
   productized Kiki recipe: every frame is z-image-turbo **text-to-image with
   the same seed** (shared character clause + per-expression trailing clause),
   then the anti-drift feathered-ellipse composite pastes only the changed
   region (mouth/eyes/face — auto-detected by frame diff, or hand-marked)
   onto the untouched base. Wizard: describe + reroll candidates → pick
   expressions from the proven catalog (editable prompts, plus custom ones) →
   regions → background job (~2 min/frame). Presets carry `generation`
   metadata in their config, so single expressions can be added or
   regenerated later from the preset page. Legacy photo presets add
   expressions via Kontext edits instead.

The original Kiki-era scripts this recipe came from are preserved verbatim in
`tools/faces/kiki/` (gen_kiki.sh, finalize_kiki.py, insert_kiki.sh,
kiki_regions.json); the live implementation is `apps/desktop/src/core/faces/`
(catalog.ts, ops.ts PIPELINE_PY, generateRunner.ts).
