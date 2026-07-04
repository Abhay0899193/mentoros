import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { kokoroReady } from "./tts.js";
import type { VoicePaths } from "./paths.js";

/**
 * Persistent, supervised Kokoro TTS sidecar. A single python process loads the
 * ~310 MB ONNX model once and stays warm, so time-to-first-chunk drops from
 * seconds (cold `python + model load` per utterance) to the cost of the first
 * segment synthesis. Requests are newline-delimited JSON on stdin; audio comes
 * back as length-prefixed frames on stdout so PCM bytes never collide with any
 * text delimiter. The worker is respawned on exit (health = process alive).
 */

const WORKER_SCRIPT_NAME = "kokoro_worker.py";
const KOKORO_VOICE = "af_heart";
export const KOKORO_WORKER_SAMPLE_RATE = 24000;

// Frame types on the worker's stdout.
const FRAME_AUDIO = 1;
const FRAME_END = 2;
const FRAME_ERROR = 3;

export const KOKORO_WORKER_SCRIPT = String.raw`import sys, struct, json, argparse, asyncio
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--voices", required=True)
ap.add_argument("--voice", default="af_heart")
ap.add_argument("--rate", type=int, default=24000)
args = ap.parse_args()

from kokoro_onnx import Kokoro

k = Kokoro(args.model, args.voices)
out = sys.stdout.buffer

def frame(t, payload=b""):
    out.write(bytes([t]) + struct.pack("<I", len(payload)) + payload)
    out.flush()

def to_pcm(samples):
    a = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    return (a * 32767.0).astype("<i2").tobytes()

async def synth(text):
    got = False
    try:
        async for samples, _sr in k.create_stream(text, voice=args.voice, speed=1.0, lang="en-us"):
            got = True
            frame(1, to_pcm(samples))
    except Exception:
        if got:
            raise
        samples, _sr = k.create(text, voice=args.voice, speed=1.0, lang="en-us")
        frame(1, to_pcm(samples))

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        text = json.loads(line).get("text", "")
    except Exception as e:
        frame(3, str(e).encode()); continue
    try:
        asyncio.run(synth(text))
        frame(2)
    except Exception as e:
        frame(3, ("kokoro synth failed: %r" % (e,)).encode())
`;

interface PendingSynth {
  push: (b: Buffer) => void;
  end: () => void;
  fail: (e: Error) => void;
}

export class KokoroWorker {
  private proc: ChildProcess | null = null;
  private scriptReady = false;
  private buf = Buffer.alloc(0);
  private readonly queue: PendingSynth[] = [];

  constructor(private readonly paths: VoicePaths) {}

  ready(): boolean {
    return kokoroReady(this.paths);
  }

  /** Eagerly warm the model so the first user utterance streams immediately. */
  async warm(): Promise<void> {
    if (this.ready()) await this.ensureStarted();
  }

  private async ensureScript(): Promise<string> {
    const scriptPath = join(this.paths.root, WORKER_SCRIPT_NAME);
    if (!this.scriptReady) {
      mkdirSync(this.paths.root, { recursive: true });
      await writeFile(scriptPath, KOKORO_WORKER_SCRIPT);
      this.scriptReady = true;
    }
    return scriptPath;
  }

  private async ensureStarted(): Promise<void> {
    if (this.proc) return;
    const scriptPath = await this.ensureScript();
    const proc = spawn(
      this.paths.venvPython,
      [scriptPath, "--model", this.paths.kokoroModel, "--voices", this.paths.kokoroVoices, "--voice", KOKORO_VOICE, "--rate", String(KOKORO_WORKER_SAMPLE_RATE)],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    proc.stdout.on("data", (d: Buffer) => this.onData(d));
    proc.stderr.on("data", () => {
      /* model-load chatter; ignored */
    });
    const onDead = (): void => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.buf = Buffer.alloc(0);
      const err = new Error("kokoro worker exited");
      while (this.queue.length) this.queue.shift()?.fail(err);
    };
    proc.on("exit", onDead);
    proc.on("error", onDead);
    this.proc = proc;
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 5) return;
      const type = this.buf[0];
      const len = this.buf.readUInt32LE(1);
      if (this.buf.length < 5 + len) return;
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      const cur = this.queue[0];
      if (type === FRAME_AUDIO) {
        cur?.push(Buffer.from(payload));
      } else if (type === FRAME_END) {
        this.queue.shift();
        cur?.end();
      } else if (type === FRAME_ERROR) {
        this.queue.shift();
        cur?.fail(new Error(payload.toString("utf8") || "kokoro error"));
      }
    }
  }

  /**
   * Stream PCM16 chunks for `text`. On abort we stop yielding to the caller but
   * keep draining the worker's frames internally so the protocol stays aligned
   * and the model remains warm (no kill/reload).
   */
  async *synthesize(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    await this.ensureStarted();
    const proc = this.proc;
    if (!proc || !proc.stdin) throw new Error("kokoro worker unavailable");

    const chunks: Buffer[] = [];
    let done = false;
    let error: Error | null = null;
    let wake: (() => void) | null = null;
    const signalWake = (): void => {
      wake?.();
      wake = null;
    };
    const pending: PendingSynth = {
      push: (b) => {
        chunks.push(b);
        signalWake();
      },
      end: () => {
        done = true;
        signalWake();
      },
      fail: (e) => {
        error = e;
        done = true;
        signalWake();
      },
    };
    this.queue.push(pending);
    signal?.addEventListener("abort", signalWake);
    proc.stdin.write(`${JSON.stringify({ text })}\n`);

    try {
      for (;;) {
        if (chunks.length > 0) {
          yield chunks.shift() as Buffer;
          continue;
        }
        if (error) throw error;
        if (done || signal?.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", signalWake);
    }
  }
}
