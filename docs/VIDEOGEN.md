# Local video generation on this machine (M4 Pro, 24 GB) — research + plan

> Researched 2026-07-11 (researcher agent, web-verified) for: "is there any text- and
> image-to-video model we can run in-app on the M4, fast?" Disk at time of research:
> ~69 GB free. **Verdict: yes — verified by smoke test (see Stage 0 results below):
> ~80–90 s per 2 s 512² clip with audio, 8.7 GB peak RAM, both T2V and I2V.** Async
> fire-and-forget job shape, same as the Preset Generator.

## Candidates surveyed (mid-2026)

| Model | Params | RAM need | Mac-runnable | Speed on M4-class | T2V | I2V | License |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **LTX-2.3 distilled (int4 MLX)** | 22B | ~12–13 GB | ✅ MLX native | **~1.6–2.4 min / 4 s @ 1080p** | ✅ | ✅ | Lightricks open |
| **Wan 2.1 T2V 1.3B** | 1.3B | ~8 GB | ✅ MLX native | ~5–8 min / 3 s @ 480p | ✅ | ❌ | Apache 2.0 |
| Wan 2.2 TI2V 5B | 5B | ~24 GB (full) | ✅ but tight | ~30–40 min / 3 s @ 720p | ✅ | ✅ | Apache 2.0 |
| AnimateDiff | ~0.5B | ~6 GB | ✅ ComfyUI/MPS | <5 min / 3 s @ 512p | ✅ | ❌ | Apache 2.0 |
| CogVideoX-5B | 5B | 16–20 GB | ⚠️ quantized | ~18 min / 4 s | ✅ | ❓ | Apache 2.0 |
| Pyramid Flow 1.2B | 1.2B | ~10 GB | ✅ MPS | 8–12 min / 3 s | ✅ | ❌ | Apache 2.0 |
| HunyuanVideo | ~27B MoE | 24+ GB | ⚠️ FP8 broken on MPS | 40+ min / 3 s | ✅ | ❌ | custom |
| LTX-2 19B bf16 | 19B | ~43 GB | ❌ doesn't fit | — | ✅ | ✅ | Lightricks open |

Why Macs are slow at this even when models fit: video VAE decode is memory-bandwidth-bound
(M4 Pro ~120 GB/s vs RTX 4090 ~1 TB/s), MPS has no fp8/`torch.compile`. 3–4× slower than a
4090 is the floor, not a tuning problem.

## Runtime: mlx-video (Blaizzy)

The same ecosystem as our mflux toolchain — MLX-native, actively maintained, MIT.

- Package: `mlx-video-with-audio` (PyPI) / `github.com/Blaizzy/mlx-video`
- Supports LTX-2 / LTX-2.3 and Wan 2.1/2.2 families, int4/int8/bf16 quantizations
- CLI shape (per family): `python -m mlx_video.ltx_2.generate --prompt … [--image base.jpg] --num-frames 97 --steps 8 --low-ram --output out.mp4`
- Checkpoints auto-download from HF into `HF_HOME` (we'd reuse `~/mentoros-imagegen/hf-cache` + `HF_HUB_DISABLE_XET=1`, same as imagegen)

Rejected runtimes: ComfyUI-on-MPS (fragile, plugin churn, no fp8), Draw Things (GUI, not
scriptable), FramePack MLX (T2V-only, tiny ecosystem).

## Recommendation

**Primary: LTX-2.3 distilled int4 via mlx-video** — the only candidate that does BOTH
text-to-video and image-to-video, at the best speed (~2 min / 4 s clip @ 1080p), in
~16–18 GB disk. I2V matters most for us: it can animate an existing preset base frame /
Image Lab render.

**Fallback: Wan 2.1 1.3B** (~10 GB, guaranteed fit, T2V only, 5–8 min) if LTX int4 turns
out too tight on 24 GB alongside the app + Electron (~2–3 GB) — LTX needs `--low-ram` and
must be smoke-tested before we build on it.

**Not worth it locally:** anything aiming at sub-minute generation. That's a hosted-API
feature (fal.ai/Replicate expose LTX/Wan/Kling in seconds for ~$0.05–0.30/clip) — we
already have the fal key plumbing from Image Lab, so a hosted video backend is a cheap
add-on later.

## ✅ Stage 0 smoke results (2026-07-11, this machine) — GO

Both T2V and I2V verified end-to-end. **Dramatically better than the research
estimates:** ~80–90 s per 2 s 512² clip (not 2 min+), peak RSS only **8.7 GB** (MLX
mmaps weights — the feared ~20 GB peak never happens, so the app can stay open).

| Run | Wall clock | Peak RSS | Output | Quality |
| --- | --- | --- | --- | --- |
| T2V 512², 49 frames @ 24 fps + audio | **87.6 s** | 8.65 GB | 106 KB mp4 | Near-photoreal woman, natural smile+wave, prompt followed; first ~10 frames are a fade-in |
| I2V same size, conditioned on Kiki base.png | **76.2 s** | 8.69 GB | mp4 | **Identity fully preserved** (face/hair/outfit/bg), wave+smile+blink motion added |

Artifacts: clips + contact sheets at `~/Desktop/mentoros-screenshots/pvideogen/`;
raw at `~/mentoros-imagegen/smoke/video/`; scripts at
`~/mentoros-imagegen/logs/videogen_smoke_{t2v,i2v}.sh`.

**Verified toolchain (corrections vs the research above):**

- Venv: `~/mentoros-imagegen/video-env/` (Python 3.12, uv), package
  `mlx-video-with-audio==0.1.36`.
- Model: `notapalindrome/ltx23-mlx-av-q4` (22.8 GB, LTX-2.3 22B distilled, MLX q4
  "split" format) — the researcher's `gajesh/…`/`baa-ai/…` repos exist but this one is
  by the package author and is format-compatible.
- Text encoder is NOT bundled: pass `--text-encoder-repo mlx-community/gemma-3-12b-it-4bit`
  (8.1 GB) or generation dies at load ("resolved to an AV model config").
- Entrypoint must be **`mlx_video.generate_av`** — plain `mlx_video.generate` only reads
  the old monolithic layout (hardcodes `ltx-2-19b-distilled.safetensors`) and cannot
  load split-format repos. `generate_av` also emits synchronized audio (bonus).
- Constraints: width/height divisible by 64; `--num-frames` must be `1+8k` (49 ≈ 2 s);
  `--steps` is IGNORED — distilled pipeline runs fixed two stages (8 steps at half-res
  → 3 refine steps at full res; stage-2 step cost ~9.3 s at 512², scales with area).
- Working command:

```bash
HF_HOME=~/mentoros-imagegen/hf-cache HF_HUB_DISABLE_XET=1 \
~/mentoros-imagegen/video-env/bin/mlx_video.generate_av \
  --prompt "…" \
  [--image /path/to/base.png] \
  --model-repo notapalindrome/ltx23-mlx-av-q4 \
  --text-encoder-repo mlx-community/gemma-3-12b-it-4bit \
  --width 512 --height 512 --num-frames 49 --fps 24 --seed 42 \
  --output-path out.mp4
```

- Progress is parseable from stderr: `STAGE:1:STEP:n:8:Denoising` / `STAGE:2:STEP:n:3:…`
  lines — feed these to the WS job progress.
- Disk after downloads: hf-cache 25→53 GB, volume back at 93% (~30 GB free). Untested:
  higher resolutions/durations (768² stage-2 will be ~2.25× slower per step), Wan
  fallback (not needed — LTX fits with huge headroom).

## ✅ Shipped — Video Lab in-app status (2026-07-11)

The feature is built and committed (Stage 1 backend `70e5add`, Stage 2 UI `0d7e02b`).
Manual test script: `MANUAL_TEST_CHECKLIST.md §8`.

**Backend — `src/core/videogen/`** (`paths,toolchain,models,store,ops,validate,service,routes`):

- **Availability probe**: `video-env/bin/mlx_video.generate_av` exec bit + LTX +
  gemma snapshot dirs present in `~/mentoros-imagegen/hf-cache`. Missing → model
  listed unavailable with an install `detail`, generate 503s.
- **Registry**: `ltx-local` (LTX-2.3 22B q4 + gemma-3-12b-it-4bit) only for now;
  `wan-local` / `ltx-fal` have reserved slots.
- **Validation**: prompt ≤ 2000 chars; width/height snapped to ÷64, clamped 256–1024;
  frames snapped to 1+8k, clamped 9–121; fps 8–30; seed uint32 (server-resolved when
  omitted → `seedUsed`); optional I2V image = data URI → temp PNG → `--image`.
- **Jobs**: single-flight (self 409) spawning the exact smoke CLI above (no `--steps`);
  progress parsed from `STAGE:n:STEP` stderr lines (stage 1 maps to 0–0.7, stage 2 to
  0.7–1.0) and broadcast as **`videogen.job` WS events** (numeric progress — richer
  than imagegen's poll-only jobs; UI needs no poll loop). Cancel = SIGTERM → 2 s →
  SIGKILL, `cancelled` is a first-class terminal state; partial mp4 deleted on
  fail/cancel; done → row in sqlite `videogen_history`. In-flight jobs do NOT survive
  an app restart (history does).
- **Routes**: `GET /videogen/models`, `POST /videogen/generate` → `{job}`
  (409 self+cross-busy / 503 toolchain / 422 invalid), `GET /videogen/jobs/:id`,
  `POST /videogen/jobs/:id/cancel`, `GET /videogen/history`,
  `DELETE /videogen/history/:id`, `GET /videogen/art/:file` with full **Range**
  support (200/206/416, immutable cache — files are write-once) for `<video>` scrubbing.
- **Cross-busy**: three-way 409s videogen ↔ imagegen ↔ faces (incl. the photo-preset
  route) — each toolchain peaks >8 GB, only one may run. Wired in `core/server.ts`.
- **Fake mode**: `MENTOROS_VIDEOGEN_FAKE=1` skips the GPU and writes a tiny real mp4 —
  use for GPU-free e2e.
- `coreClient.ts` mirror: `videogenModels/Generate/Job/Cancel/History/DeleteHistory`,
  art URLs absolutized at the client boundary, `videogen.job` WS event typed.

**UI — "Video" pill in Avatar Studio** (`screens/studio/VideoLab.tsx` +
`lib/videoLabStore.ts`, WS-driven — no poll loop):

- Model list with availability gate; prompt (⌘Enter submits); **Source image** section
  for I2V — drop/click a photo, pick an Image Lab render from imagegen history, or a
  preset base frame (built-in + custom presets), all converted to data URIs.
- Duration chips 2/3/4/5 s (= 49/73/97/121 frames) + size chips 512², 512×768, 768×512
  + free W/H steppers (step 64); live render-time estimate
  (`87 s × frames/49 × area/512²`); seed row with randomize.
- Live job card with a real numeric progress bar + stage detail + Cancel +
  continue-in-background note; error/cancelled card with retry + dismiss.
- Output pane: `<video controls loop>` + seed copy / reuse seed / reuse settings.
- History grid: inline `<video preload="metadata">` thumbs, duration badge,
  hover-delete with confirm.
- Client-side cross-busy: Generate disabled with a reason line while a faces job or
  Image Lab render is live (server 409s regardless).

## Feature plan (staged, mirrors Image Lab)

**Stage 0 — toolchain smoke. ✅ DONE (results above). GO.**

**Stage 1 — `core/videogen/`. ✅ DONE (`70e5add`)** — cloned from `core/imagegen/`
patterns: toolchain probe, model registry, single-flight background jobs w/ WS progress
+ cancel, server-resolved seed, sqlite `videogen_history`, routes
`/videogen/{models,generate,jobs,art,history}` with Range-streamed mp4. Three-way
cross-busy 409s videogen ↔ imagegen ↔ faces.

**Stage 2 — UI: "Video" as a third Avatar Studio pill. ✅ DONE (`0d7e02b`)** —
see the shipped section above.

**Stage 3 — docs + checklist §8. ✅ DONE (this doc + `MANUAL_TEST_CHECKLIST.md §8`).**
Design pass rides the user's manual §8 run (no runtime verify per standing directive).
Later/optional: hosted fal backend for seconds-fast clips; "animate this preset"
one-click I2V from the preset detail page; wan-local fallback backend.

Disk actually used: hf-cache 25 → 53 GB (LTX 22.8 GB + gemma 8.1 GB); volume at ~93 %,
~30 GB free.
