import { join } from "node:path";

/**
 * Canonical on-disk layout for voice assets, all under `<dataDir>`. Electron
 * passes its userData/data dir; headless runs default to ~/.mentoros/data
 * (see db.ts). The TTS python venv lives beside the voice dir per task spec.
 */
export interface VoicePaths {
  /** <dataDir>/voice */
  root: string;
  /** <dataDir>/voice/models */
  models: string;
  /** <dataDir>/voice/bin — our own binaries when brew is unavailable */
  bin: string;
  /** <dataDir>/voice/tmp — scratch WAVs for STT / AIFF for say */
  tmp: string;
  /** <dataDir>/voice/previews — cached one-shot voice sample WAVs */
  previews: string;
  /** whisper.cpp model (small.en default; other quality tiers live beside it) */
  whisperModel: string;
  /** <dataDir>/venv-tts */
  venv: string;
  /** <dataDir>/venv-tts/bin/python3 */
  venvPython: string;
  /** <dataDir>/voice/kokoro — onnx model + voices pack */
  kokoroDir: string;
  kokoroModel: string;
  kokoroVoices: string;
}

export const WHISPER_MODEL_FILE = "ggml-small.en.bin";
export const KOKORO_MODEL_FILE = "kokoro-v1.0.onnx";
export const KOKORO_VOICES_FILE = "voices-v1.0.bin";

export function voicePaths(dataDir: string): VoicePaths {
  const root = join(dataDir, "voice");
  const models = join(root, "models");
  const kokoroDir = join(root, "kokoro");
  const venv = join(dataDir, "venv-tts");
  return {
    root,
    models,
    bin: join(root, "bin"),
    tmp: join(root, "tmp"),
    previews: join(root, "previews"),
    whisperModel: join(models, WHISPER_MODEL_FILE),
    venv,
    venvPython: join(venv, "bin", "python3"),
    kokoroDir,
    kokoroModel: join(kokoroDir, KOKORO_MODEL_FILE),
    kokoroVoices: join(kokoroDir, KOKORO_VOICES_FILE),
  };
}

/** Absolute path of a whisper model file inside the models dir. */
export function sttModelPath(paths: VoicePaths, file: string): string {
  return join(paths.models, file);
}
