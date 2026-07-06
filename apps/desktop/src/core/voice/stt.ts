import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeWavPcm16 } from "./wav.js";
import { firstExisting, run } from "./util.js";
import type { VoicePaths } from "./paths.js";

/**
 * whisper.cpp adapter. No native WS streaming exists in whisper-server, so for
 * the push-to-talk flow we accumulate the utterance PCM and run a single pass
 * on mic-stop (Metal-accelerated small.en is well under 1s for a short clip).
 */

const BIN_CANDIDATES = ["whisper-cli", "whisper-cpp", "whisper", "main"];
const BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/** Locate a whisper binary in our managed bin dir, then on the Homebrew PATH. */
export function resolveWhisperBin(paths: VoicePaths): string | null {
  const candidates: string[] = [];
  for (const name of BIN_CANDIDATES) candidates.push(join(paths.bin, name));
  for (const dir of BIN_DIRS) for (const name of BIN_CANDIDATES) candidates.push(join(dir, name));
  return firstExisting(candidates);
}

/**
 * Clean whisper stdout into a single transcript line: drop bracketed
 * timestamps / non-speech markers, collapse whitespace.
 */
export function parseWhisperText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^\[.*\]$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TranscribeOptions {
  pcm: Buffer;
  sampleRate: number;
  paths: VoicePaths;
  bin: string;
  /** whisper model file to run with; defaults to the pinned small.en model. */
  modelPath?: string;
  signal?: AbortSignal;
}

/**
 * Transcribe one utterance. Writes a temp 16 kHz WAV, runs whisper once, parses
 * stdout. Returns "" for silence rather than throwing. Rejects only if the
 * binary errors or is missing.
 */
export async function transcribe(opts: TranscribeOptions): Promise<string> {
  mkdirSync(opts.paths.tmp, { recursive: true });
  const wavPath = join(opts.paths.tmp, `utt-${randomUUID()}.wav`);
  await writeFile(wavPath, encodeWavPcm16(opts.pcm, opts.sampleRate));
  try {
    const res = await run(
      opts.bin,
      ["-m", opts.modelPath ?? opts.paths.whisperModel, "-f", wavPath, "-l", "en", "-nt", "-np", "-t", "4"],
      { signal: opts.signal },
    );
    if (res.code !== 0) {
      throw new Error(`whisper exited ${res.code}: ${res.stderr.split("\n").slice(-3).join(" ").trim()}`);
    }
    return parseWhisperText(res.stdout);
  } finally {
    await rm(wavPath, { force: true }).catch(() => undefined);
  }
}
