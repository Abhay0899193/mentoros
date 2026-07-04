/**
 * Preload script.
 *
 * Intentionally minimal: the renderer reaches the core over HTTP/WS via
 * `lib/coreClient.ts`, so no `contextBridge` API surface is required yet. Kept
 * as an explicit, empty seam for future native-only capabilities (global
 * hotkey, tray, mic) that must not leak into the framework-agnostic path.
 */
export {};
