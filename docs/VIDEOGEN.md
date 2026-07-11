# Local video generation on this machine (M4 Pro, 24 GB) — research + plan

> Researched 2026-07-11 (researcher agent, web-verified) for: "is there any text- and
> image-to-video model we can run in-app on the M4, fast?" Disk at time of research:
> ~69 GB free. **Verdict: yes — marginally, and only for async (non-real-time) use.**
> Nothing local hits sub-minute clips on 24 GB; ~2–8 min per 3–5 s clip is the realistic
> band, same fire-and-forget job shape as the Preset Generator.

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

## ⚠️ Verify-before-build caveats

Researcher findings are web-sourced and this area moves fast; the following MUST be
confirmed by a real smoke test (Stage 0 below) before any app code is written:

1. Exact HF checkpoint ids (candidates named: `gajesh/LTX-2.3-mlx-fp16`,
   `baa-ai/LTX-2.3-22B-RAM-24GB-MLX`, `Wan-AI/Wan2.1-T2V-1.3B`) — names may be stale.
2. Exact `mlx_video` CLI module paths / flags (`mlx_video.ltx_2.generate` etc.).
3. Real wall-clock + peak RSS on THIS machine with the app closed vs open.
4. That LTX int4 I2V holds identity well enough to be useful on our preset frames.

## Feature plan (staged, mirrors Image Lab — not started, awaiting user go)

**Stage 0 — toolchain smoke (no app code).** `uv`-install mlx-video into
`~/mentoros-imagegen/` (kept-forever toolchain dir), download the LTX int4 checkpoint,
run one T2V and one I2V clip, record time/RAM/quality + exact commands into this doc
(replace the caveats section). Go/no-go gate; fallback to Wan 1.3B if LTX doesn't fit.

**Stage 1 — `core/videogen/`** cloned from `core/imagegen/` patterns: toolchain probe
(binary + weights dirs), model registry (ltx-local primary; wan-local fallback;
`ltx-fal` hosted later), single-flight background jobs w/ WS progress + cancel
(kill child), server-resolved seed, sqlite `videogen_history`, routes
`/videogen/{models,generate,jobs,art,history}` with mp4 streaming (Range header
support for `<video>` scrubbing). **Cross-busy 409s three-way**: videogen ↔ imagegen ↔
faces — every one of these peaks >10 GB in mflux/mlx-video, only one may run.

**Stage 2 — UI: "Video" as a third Avatar Studio pill** (Avatars | Image Lab | Video).
Form = prompt, optional source image (PhotoDrop + "use this render" from Image Lab
history + "use preset base frame" from a face preset), duration/resolution presets
sized to measured speed, seed row; job card with progress + cancel +
continue-in-background; history grid with inline `<video>` playback + delete.

**Stage 3 — docs + checklist §8 + design pass.** Later/optional: hosted fal backend for
seconds-fast clips; "animate this preset" one-click I2V from the preset detail page.

Est. new disk: ~16–18 GB (LTX) or ~10 GB (Wan) on top of the existing ~25 GB hf-cache.
