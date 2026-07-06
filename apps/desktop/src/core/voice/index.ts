export { registerVoice, type VoiceDeps } from "./routes.js";
export { VoiceManager } from "./manager.js";
export { voicePaths, sttModelPath, type VoicePaths } from "./paths.js";
export {
  listTtsVoices,
  voiceInfo,
  isKnownTtsVoice,
  isEnglishVoiceId,
  FALLBACK_VOICE_IDS,
  clearVoiceCache,
} from "./voices.js";
export { STT_MODELS, sttModelDef, sttModelUrl, DEFAULT_STT_MODEL } from "./sttModels.js";
