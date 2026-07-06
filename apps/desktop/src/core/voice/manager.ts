import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { sttModelPath, voicePaths, WHISPER_MODEL_FILE, type VoicePaths } from "./paths.js";
import { resolveWhisperBin, transcribe } from "./stt.js";
import {
  detectTtsEngine,
  ensureKokoroScript,
  kokoroReady,
  KOKORO_VOICE,
  synthesize as ttsSynthesize,
  type TtsStream,
} from "./tts.js";
import { KokoroWorker, KOKORO_WORKER_SAMPLE_RATE } from "./kokoroWorker.js";
import {
  DEFAULT_STT_MODEL,
  STT_MODELS,
  sttModelDef,
  sttModelUrl,
} from "./sttModels.js";
import { downloadFile, firstExisting, run } from "./util.js";
import type { AppSettings, CoreEvents, SttModelId, SttModelInfo, VoiceStatus } from "../types.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
type GetSettings = () => AppSettings;

const MODEL_PROGRESS_THROTTLE_MS = 250; // ~4 broadcasts/second

const STATUS_CACHE_MS = 3000;
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}`;
const KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const KOKORO_MODEL_URL = `${KOKORO_BASE}/kokoro-v1.0.onnx`;
const KOKORO_VOICES_URL = `${KOKORO_BASE}/voices-v1.0.bin`;
const WHISPER_REPO = "https://github.com/ggml-org/whisper.cpp.git";
/** venv-friendly x86_64 python that has onnxruntime wheels (nvm node is Rosetta, brew py is 3.14). */
const PYTHON_CANDIDATES = ["python3.12", "python3.11", "python3.13", "python3"];
const CMAKE_CANDIDATES = ["/opt/homebrew/bin/cmake", "/usr/local/bin/cmake", "cmake"];

/**
 * Owns voice-sidecar state: fast cached readiness probe + a one-shot installer
 * that downloads the whisper binary/model and the TTS runtime, broadcasting
 * `voice.install` progress and `voice.status` on readiness changes. Never
 * throws out of {@link install}; failures degrade to `error`/say-fallback.
 */
export class VoiceManager {
  readonly paths: VoicePaths;
  private cached: { status: VoiceStatus; at: number } | null = null;
  private installing = false;
  private sttError: string | null = null;
  private readonly kokoro: KokoroWorker;
  private readonly downloadingModels = new Set<SttModelId>();

  constructor(
    dataDir: string,
    private readonly broadcast: Broadcast,
    private readonly getSettings: GetSettings = () => ({
      ttsVoice: KOKORO_VOICE,
      sttModel: DEFAULT_STT_MODEL,
      mentorIdentity: "orb",
    }),
  ) {
    this.paths = voicePaths(dataDir);
    this.kokoro = new KokoroWorker(this.paths);
    // Warm the model in the background if it is already installed so the first
    // spoken response streams with minimal time-to-first-chunk.
    void this.kokoro.warm().catch(() => undefined);
  }

  sttReady(): boolean {
    return !!resolveWhisperBin(this.paths) && existsSync(this.paths.whisperModel);
  }

  private warmedSttPath: string | null = null;

  /**
   * Fire-and-forget: pay whisper's cold start (model load + one-time Metal
   * shader compile, ~7s) on a sliver of silence when a /voice channel opens,
   * so the user's first real utterance transcribes fast instead of tripping
   * the renderer's deadline. Re-warms when the active model changes.
   */
  warmStt(): void {
    const bin = this.whisperBin();
    if (!bin || !this.sttReady()) return;
    const modelPath = this.activeSttModelPath();
    if (this.warmedSttPath === modelPath) return;
    this.warmedSttPath = modelPath;
    const silence = Buffer.alloc(6400); // 200ms of 16kHz PCM16
    void transcribe({ pcm: silence, sampleRate: 16000, paths: this.paths, bin, modelPath }).catch(
      () => {
        this.warmedSttPath = null;
      },
    );
  }

  whisperBin(): string | null {
    return resolveWhisperBin(this.paths);
  }

  ttsEngine(): { engine: "kokoro" | "say" | null; detail: string } {
    return detectTtsEngine(this.paths);
  }

  /**
   * Build a streaming synthesis for the current best engine, or null if none is
   * available. Kokoro streams from the warm worker (per-utterance spawn is used
   * only as a last-resort fallback); `say` uses the always-present bridge.
   */
  synthesize(text: string, signal?: AbortSignal, voiceOverride?: string): TtsStream | null {
    const { engine } = detectTtsEngine(this.paths);
    if (!engine) return null;
    const voice = voiceOverride ?? this.getSettings().ttsVoice ?? KOKORO_VOICE;
    if (engine === "kokoro") {
      return {
        engine,
        sampleRate: KOKORO_WORKER_SAMPLE_RATE,
        stream: this.kokoroStream(text, signal, voice),
      };
    }
    // macOS `say` has no per-voice mapping here; the requested voice is a no-op.
    return ttsSynthesize(text, "say", this.paths, signal, voice);
  }

  /**
   * Drain a full synthesis into one PCM16 buffer (used for cached voice
   * previews — independent of any open /voice channel).
   */
  async synthesizeToPcm(
    text: string,
    voice: string,
    signal?: AbortSignal,
  ): Promise<{ pcm: Buffer; sampleRate: number } | null> {
    const synth = this.synthesize(text, signal, voice);
    if (!synth) return null;
    const parts: Buffer[] = [];
    for await (const chunk of synth.stream) {
      if (signal?.aborted) break;
      parts.push(chunk);
    }
    return { pcm: Buffer.concat(parts), sampleRate: synth.sampleRate };
  }

  private async *kokoroStream(text: string, signal?: AbortSignal, voice?: string): AsyncGenerator<Buffer> {
    // Kokoro may emit a whole segment as one large buffer; re-slice into
    // ~4096-frame (8192-byte) chunks so the renderer/Orb gets smooth, paced
    // audio matching the documented frame size.
    const CHUNK = 4096 * 2;
    let residual = Buffer.alloc(0);
    let any = false;
    try {
      for await (const chunk of this.kokoro.synthesize(text, signal, voice)) {
        any = true;
        residual = Buffer.concat([residual, chunk]);
        while (residual.length >= CHUNK && !signal?.aborted) {
          yield residual.subarray(0, CHUNK);
          residual = residual.subarray(CHUNK);
        }
      }
    } catch (err) {
      if (any) throw err; // partial stream already sent; cannot recover
    }
    if (any) {
      if (!signal?.aborted && residual.length > 0) yield residual;
      return;
    }
    if (signal?.aborted) return;
    // Worker produced nothing — fall back to a one-shot python synthesis.
    const fb = ttsSynthesize(text, "kokoro", this.paths, signal, voice);
    for await (const chunk of fb.stream) {
      if (signal?.aborted) return;
      yield chunk;
    }
  }

  /** Cached (~3s) so /voice/status stays well under 300ms. */
  status(): VoiceStatus {
    const now = Date.now();
    if (this.cached && now - this.cached.at < STATUS_CACHE_MS) return this.cached.status;

    const stt: VoiceStatus["stt"] = this.installing && !this.sttReady()
      ? "starting"
      : this.sttError
        ? "error"
        : this.sttReady()
          ? "ready"
          : "missing";

    const tts = detectTtsEngine(this.paths);
    const ttsState: VoiceStatus["tts"] = this.installing && !kokoroReady(this.paths)
      ? "starting"
      : tts.engine
        ? "ready"
        : "missing";

    const detailParts = [
      `STT ${stt === "ready" ? "whisper small.en" : stt}`,
      `TTS ${tts.detail}`,
    ];
    if (this.sttError) detailParts.push(this.sttError);

    const status: VoiceStatus = { stt, tts: ttsState, detail: detailParts.join(" · ") };
    this.cached = { status, at: now };
    return status;
  }

  private refresh(): void {
    this.cached = null;
    this.broadcast("voice.status", this.status());
  }

  /* --------------------------- STT model options -------------------------- */

  private modelReady(id: SttModelId): boolean {
    const def = sttModelDef(id);
    return !!def && existsSync(sttModelPath(this.paths, def.file));
  }

  /** The model id STT actually uses: the selection if ready, else small.en. */
  private activeSttModelId(): SttModelId {
    const selected = this.getSettings().sttModel;
    if (this.modelReady(selected)) return selected;
    return DEFAULT_STT_MODEL;
  }

  /** Absolute path of the active whisper model file (falls back to small.en). */
  activeSttModelPath(): string {
    const def = sttModelDef(this.activeSttModelId()) ?? sttModelDef(DEFAULT_STT_MODEL);
    return def ? sttModelPath(this.paths, def.file) : this.paths.whisperModel;
  }

  /** State + active flag for every model in the quality ladder. */
  sttModels(): SttModelInfo[] {
    const activeId = this.modelReady(this.activeSttModelId()) ? this.activeSttModelId() : null;
    return STT_MODELS.map((def) => {
      const state: SttModelInfo["state"] = this.downloadingModels.has(def.id)
        ? "downloading"
        : existsSync(sttModelPath(this.paths, def.file))
          ? "ready"
          : "missing";
      return {
        id: def.id,
        label: def.label,
        sizeBytes: def.sizeBytes,
        note: def.note,
        state,
        active: def.id === activeId && state === "ready",
      };
    });
  }

  /** 'unknown' (→404) | 'in-flight' (→409) | 'ok' (→204, download started). */
  startSttModelDownload(id: SttModelId): "unknown" | "in-flight" | "ok" {
    const def = sttModelDef(id);
    if (!def) return "unknown";
    if (this.downloadingModels.has(id)) return "in-flight";
    if (existsSync(sttModelPath(this.paths, def.file))) {
      // Already present; report a single done frame so the UI settles.
      this.broadcast("voice.model", {
        model: id,
        completedBytes: def.sizeBytes,
        totalBytes: def.sizeBytes,
        done: true,
      });
      return "ok";
    }
    this.downloadingModels.add(id);
    void this.runSttModelDownload(def.id).finally(() => {
      this.downloadingModels.delete(id);
      this.refresh();
    });
    return "ok";
  }

  private async runSttModelDownload(id: SttModelId): Promise<void> {
    const def = sttModelDef(id);
    if (!def) return;
    mkdirSync(this.paths.models, { recursive: true });
    const dest = sttModelPath(this.paths, def.file);
    // downloadFile streams to <dest>.part then renames; content-length is the
    // authoritative total. Throttle progress to ~4/s.
    let lastAt = 0;
    let lastTotal = def.sizeBytes;
    try {
      await downloadFile(sttModelUrl(def), dest, (p) => {
        lastTotal = p.totalBytes || lastTotal;
        const now = Date.now();
        if (now - lastAt >= MODEL_PROGRESS_THROTTLE_MS) {
          lastAt = now;
          this.broadcast("voice.model", {
            model: id,
            completedBytes: p.completedBytes,
            totalBytes: lastTotal,
            done: false,
          });
        }
      });
      this.broadcast("voice.model", {
        model: id,
        completedBytes: lastTotal,
        totalBytes: lastTotal,
        done: true,
      });
    } catch (err) {
      // downloadFile already removes its .part on failure; belt-and-suspenders.
      await rm(`${dest}.part`, { force: true }).catch(() => undefined);
      this.broadcast("voice.model", {
        model: id,
        completedBytes: 0,
        totalBytes: lastTotal,
        done: true,
        error: (err as Error).message,
      });
    }
  }

  install(): void {
    if (this.installing) return;
    this.installing = true;
    this.sttError = null;
    this.refresh();
    void this.runInstall().finally(() => {
      this.installing = false;
      this.refresh();
    });
  }

  private step(step: string, completedBytes: number, totalBytes: number, done: boolean, error?: string): void {
    this.broadcast("voice.install", { step, completedBytes, totalBytes, done, ...(error ? { error } : {}) });
  }

  private async runInstall(): Promise<void> {
    mkdirSync(this.paths.models, { recursive: true });
    mkdirSync(this.paths.bin, { recursive: true });
    mkdirSync(this.paths.tmp, { recursive: true });

    await this.installWhisperBinary();
    await this.installWhisperModel();
    await this.installTts();
    void this.kokoro.warm().catch(() => undefined);
    this.refresh();
  }

  /**
   * Provision the whisper.cpp binary. Homebrew is preferred, but this machine's
   * brew is a non-writable x86_64 install, so the reliable path is a from-source
   * build (arm64 + Metal, statically linked → self-contained). cmake comes from
   * a pip wheel in the managed venv when it isn't already on PATH.
   */
  private async installWhisperBinary(): Promise<void> {
    if (resolveWhisperBin(this.paths)) {
      this.step("whisper-binary", 1, 1, true);
      return;
    }
    this.step("whisper-binary", 0, 1, false);
    try {
      const cmake = await this.ensureCmake();
      if (!cmake) throw new Error("cmake unavailable (pip install failed)");

      const srcDir = join(this.paths.root, "whisper-src");
      if (!existsSync(join(srcDir, "CMakeLists.txt"))) {
        const clone = await run("git", ["clone", "--depth", "1", WHISPER_REPO, srcDir]);
        if (clone.code !== 0) throw new Error(`git clone failed: ${clone.stderr.slice(-200)}`);
      }
      this.step("whisper-binary", 0, 1, false);

      const buildDir = join(srcDir, "build");
      // arm64 forced + GGML_NATIVE off: host toolchain is x86_64/Rosetta, so
      // -mcpu=native would be rejected; static libs keep the binary portable.
      const cfg = await run(cmake, [
        "-B", buildDir,
        "-DCMAKE_OSX_ARCHITECTURES=arm64",
        "-DGGML_NATIVE=OFF",
        "-DBUILD_SHARED_LIBS=OFF",
        "-DWHISPER_BUILD_TESTS=OFF",
        "-DWHISPER_BUILD_EXAMPLES=ON",
        "-DWHISPER_BUILD_SERVER=OFF",
        "-DGGML_METAL=ON",
        "-DGGML_METAL_EMBED_LIBRARY=ON",
        "-DCMAKE_BUILD_TYPE=Release",
      ], { cwd: srcDir });
      if (cfg.code !== 0) throw new Error(`cmake configure failed: ${cfg.stderr.slice(-200)}`);

      const build = await run(cmake, ["--build", buildDir, "-j", "--config", "Release", "--target", "whisper-cli"], { cwd: srcDir });
      const built = join(buildDir, "bin", "whisper-cli");
      if (build.code !== 0 || !existsSync(built)) {
        throw new Error(`cmake build failed: ${build.stderr.slice(-200)}`);
      }

      mkdirSync(this.paths.bin, { recursive: true });
      const dest = join(this.paths.bin, "whisper-cli");
      copyFileSync(built, dest);
      chmodSync(dest, 0o755);

      if (resolveWhisperBin(this.paths)) {
        this.step("whisper-binary", 1, 1, true);
        this.refresh();
        return;
      }
      throw new Error("binary not resolvable after build");
    } catch (err) {
      this.sttError = `whisper build error: ${(err as Error).message}`;
      this.step("whisper-binary", 0, 1, true, this.sttError);
    }
  }

  /** Return a usable cmake path, installing it into the venv via pip if needed. */
  private async ensureCmake(): Promise<string | null> {
    const onPath = firstExisting(CMAKE_CANDIDATES.filter((c) => c.startsWith("/")));
    if (onPath) return onPath;
    try {
      const probe = await run("cmake", ["--version"]);
      if (probe.code === 0) return "cmake";
    } catch {
      /* not on PATH */
    }
    // Bootstrap cmake from a pip wheel in the (TTS) venv.
    if (!existsSync(this.paths.venvPython)) {
      const py = await this.findPython();
      if (!py) return null;
      const venvRes = await run(py, ["-m", "venv", this.paths.venv]);
      if (venvRes.code !== 0) return null;
    }
    const pip = await run(this.paths.venvPython, ["-m", "pip", "install", "-q", "cmake"], {
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    });
    if (pip.code !== 0) return null;
    const venvCmake = join(this.paths.venv, "bin", "cmake");
    return existsSync(venvCmake) ? venvCmake : null;
  }

  private async installWhisperModel(): Promise<void> {
    if (existsSync(this.paths.whisperModel) && statSync(this.paths.whisperModel).size > 1_000_000) {
      this.step("whisper-model", 1, 1, true);
      return;
    }
    try {
      await downloadFile(WHISPER_MODEL_URL, this.paths.whisperModel, (p) =>
        this.step("whisper-model", p.completedBytes, p.totalBytes, false),
      );
      this.step("whisper-model", 1, 1, true);
      this.refresh();
    } catch (err) {
      this.sttError = `model download failed: ${(err as Error).message}`;
      this.step("whisper-model", 0, 1, true, this.sttError);
    }
  }

  /**
   * One honest Kokoro attempt: build a venv, install kokoro-onnx, fetch model +
   * voices. Any failure is non-fatal — TTS degrades to the always-present macOS
   * `say` fallback (detectTtsEngine handles the readiness view).
   */
  private async installTts(): Promise<void> {
    if (kokoroReady(this.paths)) {
      this.step("tts-kokoro", 1, 1, true);
      return;
    }
    try {
      this.step("tts-venv", 0, 1, false);
      if (!existsSync(this.paths.venvPython)) {
        const py = await this.findPython();
        if (!py) throw new Error("no suitable python3 found");
        const venvRes = await run(py, ["-m", "venv", this.paths.venv]);
        if (venvRes.code !== 0) throw new Error(`venv failed: ${venvRes.stderr.slice(-200)}`);
      }
      this.step("tts-venv", 1, 1, true);

      this.step("tts-pip", 0, 1, false);
      const pip = await run(this.paths.venvPython, ["-m", "pip", "install", "-q", "kokoro-onnx", "numpy"], {
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      });
      if (pip.code !== 0) throw new Error(`pip failed: ${pip.stderr.slice(-300)}`);
      this.step("tts-pip", 1, 1, true);

      mkdirSync(this.paths.kokoroDir, { recursive: true });
      if (!existsSync(this.paths.kokoroVoices)) {
        await downloadFile(KOKORO_VOICES_URL, this.paths.kokoroVoices, (p) =>
          this.step("tts-voices", p.completedBytes, p.totalBytes, false),
        );
      }
      this.step("tts-voices", 1, 1, true);
      if (!existsSync(this.paths.kokoroModel)) {
        await downloadFile(KOKORO_MODEL_URL, this.paths.kokoroModel, (p) =>
          this.step("tts-model", p.completedBytes, p.totalBytes, false),
        );
      }
      this.step("tts-model", 1, 1, true);

      await ensureKokoroScript(this.paths);
      this.step("tts-kokoro", 1, 1, true);
      this.refresh();
    } catch (err) {
      // Non-fatal: say-fallback remains. Report but do not surface as tts:error.
      this.step("tts-kokoro", 0, 1, true, `kokoro unavailable, using macOS say: ${(err as Error).message}`);
    }
  }

  private async findPython(): Promise<string | null> {
    for (const cand of PYTHON_CANDIDATES) {
      try {
        const r = await run(cand, ["--version"]);
        if (r.code === 0) return cand;
      } catch {
        /* not on PATH */
      }
    }
    return null;
  }
}
