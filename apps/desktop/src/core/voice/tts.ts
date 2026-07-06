import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chunkBuffer, decodeWavPcm16 } from "./wav.js";
import { run } from "./util.js";
import type { VoicePaths } from "./paths.js";

/**
 * TTS with two engines behind one streaming interface:
 *  - Kokoro (kokoro-onnx in the managed venv) — American English af_heart,
 *    24 kHz, streamed as it synthesizes for low time-to-first-chunk.
 *  - macOS `say` — reliable arm64-native fallback when Kokoro is unavailable.
 * Both emit signed 16-bit little-endian mono PCM at {@link TTS_SAMPLE_RATE}.
 */

export const TTS_SAMPLE_RATE = 24000;
const CHUNK_FRAMES = 4096;
const CHUNK_BYTES = CHUNK_FRAMES * 2;
export const KOKORO_VOICE = "af_heart";
export const KOKORO_SCRIPT_NAME = "kokoro_tts.py";

export type TtsEngine = "kokoro" | "say";

export interface TtsStream {
  engine: TtsEngine;
  sampleRate: number;
  stream: AsyncGenerator<Buffer>;
}

export function kokoroReady(paths: VoicePaths): boolean {
  return (
    existsSync(paths.venvPython) && existsSync(paths.kokoroModel) && existsSync(paths.kokoroVoices)
  );
}

export function sayAvailable(): boolean {
  return existsSync("/usr/bin/say") && existsSync("/usr/bin/afconvert");
}

export function detectTtsEngine(paths: VoicePaths): { engine: TtsEngine | null; detail: string } {
  if (kokoroReady(paths)) return { engine: "kokoro", detail: `Kokoro ${KOKORO_VOICE} (24 kHz)` };
  if (sayAvailable()) return { engine: "say", detail: "fallback: macOS say" };
  return { engine: null, detail: "no TTS engine available" };
}

/** Kokoro driver script (written to disk at install; kept here to dodge the bundler). */
export const KOKORO_SCRIPT = String.raw`import sys, argparse, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--voices", required=True)
ap.add_argument("--voice", default="af_heart")
ap.add_argument("--rate", type=int, default=24000)
args = ap.parse_args()

text = sys.stdin.buffer.read().decode("utf-8", "replace").strip()
if not text:
    sys.exit(0)

from kokoro_onnx import Kokoro

k = Kokoro(args.model, args.voices)
out = sys.stdout.buffer

def emit(samples):
    pcm = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    out.write((pcm * 32767.0).astype("<i2").tobytes())
    out.flush()

streamed = False
try:
    import asyncio
    async def _run():
        async for samples, _sr in k.create_stream(text, voice=args.voice, speed=1.0, lang="en-us"):
            emit(samples)
    asyncio.run(_run())
    streamed = True
except Exception as e:
    sys.stderr.write("stream path failed: %r\n" % (e,))

if not streamed:
    samples, _sr = k.create(text, voice=args.voice, speed=1.0, lang="en-us")
    emit(samples)
`;

export async function ensureKokoroScript(paths: VoicePaths): Promise<string> {
  mkdirSync(paths.root, { recursive: true });
  const scriptPath = join(paths.root, KOKORO_SCRIPT_NAME);
  await writeFile(scriptPath, KOKORO_SCRIPT);
  return scriptPath;
}

export function synthesize(
  text: string,
  engine: TtsEngine,
  paths: VoicePaths,
  signal?: AbortSignal,
  voice: string = KOKORO_VOICE,
): TtsStream {
  const stream =
    engine === "kokoro" ? kokoroStream(text, paths, signal, voice) : sayStream(text, paths, signal);
  return { engine, sampleRate: TTS_SAMPLE_RATE, stream };
}

async function* kokoroStream(
  text: string,
  paths: VoicePaths,
  signal?: AbortSignal,
  voice: string = KOKORO_VOICE,
): AsyncGenerator<Buffer> {
  const scriptPath = join(paths.root, KOKORO_SCRIPT_NAME);
  const child = spawn(
    paths.venvPython,
    [scriptPath, "--model", paths.kokoroModel, "--voices", paths.kokoroVoices, "--voice", voice, "--rate", String(TTS_SAMPLE_RATE)],
    { signal },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.stdin.write(text);
  child.stdin.end();

  let residual = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      residual = Buffer.concat([residual, chunk]);
      while (residual.length >= CHUNK_BYTES) {
        yield residual.subarray(0, CHUNK_BYTES);
        residual = residual.subarray(CHUNK_BYTES);
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    throw err;
  }
  const tail = residual.length - (residual.length % 2);
  if (tail > 0) yield residual.subarray(0, tail);
  if (child.exitCode && child.exitCode !== 0 && !signal?.aborted) {
    throw new Error(`kokoro exited ${child.exitCode}: ${stderr.slice(-200).trim()}`);
  }
}

async function* sayStream(
  text: string,
  paths: VoicePaths,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  mkdirSync(paths.tmp, { recursive: true });
  const id = randomUUID();
  const aiff = join(paths.tmp, `say-${id}.aiff`);
  const wav = join(paths.tmp, `say-${id}.wav`);
  try {
    const said = await run("/usr/bin/say", ["-o", aiff, "--", text], { signal });
    if (said.code !== 0) throw new Error(`say exited ${said.code}: ${said.stderr.trim()}`);
    const conv = await run(
      "/usr/bin/afconvert",
      ["-f", "WAVE", "-d", `LEI16@${TTS_SAMPLE_RATE}`, "-c", "1", aiff, wav],
      { signal },
    );
    if (conv.code !== 0) throw new Error(`afconvert exited ${conv.code}: ${conv.stderr.trim()}`);
    const { pcm } = decodeWavPcm16(await readFile(wav));
    for (const chunk of chunkBuffer(pcm, CHUNK_BYTES)) {
      if (signal?.aborted) return;
      yield Buffer.from(chunk);
    }
  } finally {
    await rm(aiff, { force: true }).catch(() => undefined);
    await rm(wav, { force: true }).catch(() => undefined);
  }
}
