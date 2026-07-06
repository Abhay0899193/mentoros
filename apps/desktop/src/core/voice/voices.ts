import { existsSync } from "node:fs";
import { run } from "./util.js";
import type { VoicePaths } from "./paths.js";
import type { TtsVoiceInfo } from "../types.js";

/**
 * English Kokoro v1.0 voice catalog. Voices are enumerated authoritatively from
 * the installed voices pack (a one-shot venv python), filtered to English ids
 * (af_/am_/bf_/bm_ = american/british × female/male). When python or the pack
 * is unavailable we fall back to the known v1.0 English list so the picker and
 * settings validation still work offline. Pure mapping helpers stay trivially
 * unit-testable.
 */

/** Known v1.0 English voice ids — the canonical set for offline validation. */
export const FALLBACK_VOICE_IDS: readonly string[] = [
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis",
];

const ENGLISH_PREFIXES = ["af_", "am_", "bf_", "bm_"];

/** True when `id` looks like an English Kokoro voice (prefix a/b × f/m). */
export function isEnglishVoiceId(id: string): boolean {
  return ENGLISH_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Map a Kokoro id to display metadata. `a`→american / `b`→british,
 * `f`→female / `m`→male; label is the remainder capitalized
 * (`af_heart` → "Heart"). Returns null for ids that are not English voices.
 */
export function voiceInfo(id: string): TtsVoiceInfo | null {
  const m = /^([ab])([fm])_(.+)$/.exec(id);
  if (!m) return null;
  const accent = m[1] === "a" ? "american" : "british";
  const gender = m[2] === "f" ? "female" : "male";
  const rest = m[3];
  const label = rest.charAt(0).toUpperCase() + rest.slice(1);
  return { id, label, accent, gender };
}

/** Validation set: the fallback catalog is the authoritative known-voice list. */
export function isKnownTtsVoice(id: string): boolean {
  return FALLBACK_VOICE_IDS.includes(id);
}

function toInfos(ids: readonly string[]): TtsVoiceInfo[] {
  return ids
    .filter(isEnglishVoiceId)
    .map(voiceInfo)
    .filter((v): v is TtsVoiceInfo => v !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

let cache: TtsVoiceInfo[] | null = null;

/** Reset the in-memory enumeration cache (tests). */
export function clearVoiceCache(): void {
  cache = null;
}

/** One-shot enumeration of English voices from the installed pack. */
async function enumerateVoiceIds(paths: VoicePaths): Promise<string[] | null> {
  if (!existsSync(paths.venvPython) || !existsSync(paths.kokoroModel) || !existsSync(paths.kokoroVoices)) {
    return null;
  }
  const pySrc =
    "from kokoro_onnx import Kokoro\n" +
    "import sys\n" +
    "k=Kokoro(sys.argv[1], sys.argv[2])\n" +
    'print("\\n".join(sorted(k.get_voices())))\n';
  try {
    const res = await run(paths.venvPython, ["-c", pySrc, paths.kokoroModel, paths.kokoroVoices]);
    if (res.code !== 0) return null;
    const ids = res.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

/**
 * English Kokoro voices, enumerated from the installed pack when possible and
 * cached in memory; falls back to the known v1.0 list when python/pack is
 * missing. Always returns a non-empty, id-sorted list.
 */
export async function listTtsVoices(paths: VoicePaths): Promise<TtsVoiceInfo[]> {
  if (cache) return cache;
  const enumerated = await enumerateVoiceIds(paths);
  cache = toInfos(enumerated ?? FALLBACK_VOICE_IDS);
  if (cache.length === 0) cache = toInfos(FALLBACK_VOICE_IDS);
  return cache;
}
