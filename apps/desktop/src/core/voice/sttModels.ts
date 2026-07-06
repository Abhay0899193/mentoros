import type { SttModelId } from "../types.js";

/**
 * whisper.cpp model registry — the quality/latency ladder surfaced in Settings.
 * `sizeBytes` is display/estimate copy for the picker; download progress totals
 * come from the live content-length (see VoiceManager.downloadSttModel), not
 * these constants, so a re-published model never strands the progress bar.
 */

export interface SttModelDef {
  id: SttModelId;
  file: string;
  label: string;
  note: string;
  sizeBytes: number;
}

export const STT_MODEL_URL_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

export const STT_MODELS: readonly SttModelDef[] = [
  {
    id: "small.en",
    file: "ggml-small.en.bin",
    label: "Small — default",
    note: "fastest, good accuracy",
    sizeBytes: 488214113,
  },
  {
    id: "medium.en",
    file: "ggml-medium.en.bin",
    label: "Medium — higher accuracy",
    note: "noticeably better transcripts, ~2-3× slower",
    sizeBytes: 1533763059,
  },
  {
    id: "large-v3-turbo",
    file: "ggml-large-v3-turbo.bin",
    label: "Large v3 Turbo — best",
    note: "best accuracy, needs the most memory",
    sizeBytes: 1624555275,
  },
];

/** The shipped default that STT always falls back to. */
export const DEFAULT_STT_MODEL: SttModelId = "small.en";

export function sttModelDef(id: SttModelId): SttModelDef | undefined {
  return STT_MODELS.find((m) => m.id === id);
}

export function sttModelUrl(def: SttModelDef): string {
  return `${STT_MODEL_URL_BASE}${def.file}`;
}
