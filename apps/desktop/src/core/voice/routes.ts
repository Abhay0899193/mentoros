import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { VoiceManager } from "./manager.js";
import { transcribe } from "./stt.js";
import { encodeWavPcm16, pcm16DurationMs } from "./wav.js";
import { isKnownTtsVoice, listTtsVoices } from "./voices.js";
import { sttModelDef } from "./sttModels.js";
import type { AppSettings, CoreEvents, SttModelId } from "../types.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

const PREVIEW_TEXT = "Hey Abhay — I'm your mentor. This is how I sound.";

export interface VoiceDeps {
  broadcast: Broadcast;
  dataDir: string;
  /** Current app settings (TTS voice + STT model). Defaults are used if absent. */
  getSettings?: () => AppSettings;
}

/** Per-connection state for a /voice websocket. */
interface VoiceConn {
  socket: WebSocket;
  sampleRate: number;
  recording: boolean;
  chunks: Buffer[];
  bytes: number;
  ttsAbort: AbortController | null;
}

const MAX_UTTERANCE_BYTES = 16000 * 2 * 60; // 60s of 16 kHz PCM16 — hard cap
// Pace TTS at ~85% of realtime: first chunk goes out immediately (low TTFC),
// the rest trickle slightly ahead of playback so the Orb animates in sync and
// a `tts-stop` barge-in actually interrupts audio still in flight.
const PACE_FACTOR = 0.85;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function sendJson(socket: WebSocket, obj: unknown): void {
  try {
    socket.send(JSON.stringify(obj));
  } catch {
    /* socket mid-teardown */
  }
}

/**
 * Registers the /voice websocket and /voice HTTP routes. Mirrors the protocol
 * documented in coreClient.ts. Accepts connections and returns clear
 * `voice-error` frames even when sidecars are missing — never crashes.
 */
export function registerVoice(app: FastifyInstance, deps: VoiceDeps): void {
  const mgr = new VoiceManager(deps.dataDir, deps.broadcast, deps.getSettings);
  const conns = new Set<VoiceConn>();

  app.get("/voice/status", async () => mgr.status());

  /* ------------------------- voice options (Settings) -------------------- */

  app.get("/voice/voices", async () => listTtsVoices(mgr.paths));

  app.get<{ Querystring: { voice?: string } }>("/voice/preview", async (req, reply) => {
    const voice = req.query.voice?.trim();
    if (!voice || !isKnownTtsVoice(voice)) {
      return reply.code(400).send({ error: "unknown voice" });
    }
    const { engine } = mgr.ttsEngine();
    if (!engine) return reply.code(503).send({ error: "no TTS engine available" });

    // Cache one-shot samples on disk so replays are instant; previews are fully
    // independent of the /voice channel (their own synthesis + abort scope).
    const cachePath = join(mgr.paths.previews, `${voice}.wav`);
    if (existsSync(cachePath)) {
      return reply.type("audio/wav").send(await readFile(cachePath));
    }
    try {
      const abort = new AbortController();
      const out = await mgr.synthesizeToPcm(PREVIEW_TEXT, voice, abort.signal);
      if (!out || out.pcm.length === 0) {
        return reply.code(503).send({ error: "synthesis produced no audio" });
      }
      const wav = encodeWavPcm16(out.pcm, out.sampleRate);
      mkdirSync(mgr.paths.previews, { recursive: true });
      await writeFile(cachePath, wav).catch(() => undefined);
      return reply.type("audio/wav").send(wav);
    } catch (err) {
      return reply.code(503).send({ error: `preview failed: ${(err as Error).message}` });
    }
  });

  app.get("/voice/stt-models", async () => mgr.sttModels());

  app.post<{ Params: { id: string } }>("/voice/stt-models/:id/download", async (req, reply) => {
    const id = req.params.id;
    if (!sttModelDef(id as SttModelId)) {
      return reply.code(404).send({ error: `unknown model: ${id}` });
    }
    const result = mgr.startSttModelDownload(id as SttModelId);
    if (result === "in-flight") return reply.code(409).send({ error: "already downloading" });
    return reply.code(204).send();
  });

  app.post("/voice/install", async (_req, reply) => {
    mgr.install();
    return reply.code(202).send({ started: true });
  });

  app.post<{ Body: { pressed?: boolean } }>("/voice/ptt", async (req) => {
    const pressed = !!req.body?.pressed;
    deps.broadcast("voice.ptt", { pressed });
    return { ok: true, pressed };
  });

  app.post<{ Body: { text?: string } }>("/voice/speak", async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: "text is required" });
    if (conns.size === 0) return reply.code(409).send({ error: "no /voice channel connected" });

    const { engine } = mgr.ttsEngine();
    if (!engine) return reply.code(503).send({ error: "no TTS engine available" });

    for (const conn of conns) void streamTtsTo(conn, text, mgr);
    return reply.code(200).send({ speaking: true, engine });
  });

  void app.register(async (instance) => {
    instance.get("/voice", { websocket: true }, (socket) => {
      const conn: VoiceConn = {
        socket,
        sampleRate: 16000,
        recording: false,
        chunks: [],
        bytes: 0,
        ttsAbort: null,
      };
      conns.add(conn);
      mgr.warmStt();

      socket.on("message", (raw: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (!conn.recording) return;
          if (conn.bytes < MAX_UTTERANCE_BYTES) {
            conn.chunks.push(Buffer.from(raw));
            conn.bytes += raw.length;
          }
          return;
        }
        let msg: { type?: string; sampleRate?: number };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        switch (msg.type) {
          case "mic-start":
            handleMicStart(conn, msg.sampleRate ?? 16000, mgr);
            break;
          case "mic-stop":
            void handleMicStop(conn, mgr);
            break;
          case "tts-stop":
            conn.ttsAbort?.abort();
            conn.ttsAbort = null;
            break;
          default:
            break;
        }
      });

      const cleanup = (): void => {
        conn.ttsAbort?.abort();
        conns.delete(conn);
      };
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    });
  });
}

function handleMicStart(conn: VoiceConn, sampleRate: number, mgr: VoiceManager): void {
  conn.chunks = [];
  conn.bytes = 0;
  conn.sampleRate = sampleRate > 0 ? sampleRate : 16000;
  if (!mgr.sttReady()) {
    conn.recording = false;
    sendJson(conn.socket, {
      type: "voice-error",
      message: "Speech recognition is not installed yet. Run voice setup to enable it.",
    });
    return;
  }
  conn.recording = true;
}

async function handleMicStop(conn: VoiceConn, mgr: VoiceManager): Promise<void> {
  if (!conn.recording) return;
  conn.recording = false;
  const pcm = Buffer.concat(conn.chunks);
  conn.chunks = [];
  conn.bytes = 0;

  const bin = mgr.whisperBin();
  if (!bin || !mgr.sttReady()) {
    sendJson(conn.socket, { type: "voice-error", message: "Speech recognition is not installed yet." });
    return;
  }
  if (pcm16DurationMs(pcm, conn.sampleRate) < 120) {
    sendJson(conn.socket, { type: "transcript", text: "", final: true });
    return;
  }
  try {
    const text = await transcribe({
      pcm,
      sampleRate: conn.sampleRate,
      paths: mgr.paths,
      bin,
      modelPath: mgr.activeSttModelPath(),
    });
    sendJson(conn.socket, { type: "transcript", text, final: true });
  } catch (err) {
    sendJson(conn.socket, { type: "voice-error", message: `Transcription failed: ${(err as Error).message}` });
  }
}

async function streamTtsTo(conn: VoiceConn, text: string, mgr: VoiceManager): Promise<void> {
  conn.ttsAbort?.abort();
  const abort = new AbortController();
  conn.ttsAbort = abort;

  const synth = mgr.synthesize(text, abort.signal);
  if (!synth) {
    sendJson(conn.socket, { type: "voice-error", message: "No TTS engine available." });
    conn.ttsAbort = null;
    return;
  }
  const { sampleRate, stream } = synth;
  sendJson(conn.socket, { type: "tts-start", sampleRate });
  try {
    for await (const chunk of stream) {
      if (abort.signal.aborted) break;
      try {
        conn.socket.send(chunk);
      } catch {
        break;
      }
      const frameMs = (chunk.length / 2 / sampleRate) * 1000;
      await abortableSleep(frameMs * PACE_FACTOR, abort.signal);
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      sendJson(conn.socket, { type: "voice-error", message: `Synthesis failed: ${(err as Error).message}` });
    }
  } finally {
    if (!abort.signal.aborted) sendJson(conn.socket, { type: "tts-end" });
    if (conn.ttsAbort === abort) conn.ttsAbort = null;
  }
}
