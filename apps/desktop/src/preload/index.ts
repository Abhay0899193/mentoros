/**
 * Preload script.
 *
 * Intentionally minimal: the renderer reaches the core over HTTP/WS via
 * `lib/coreClient.ts`. This bridge only exposes native-shell capabilities a
 * browser genuinely cannot provide — currently just resolving a dragged File
 * to its absolute path (Electron ≥32 removed `File.path`). Renderer code must
 * go through `lib/nativeBridge.ts`, never `window.mentoros` directly, so
 * future web/mobile shells can supply their own fallback (§2.2).
 */
import { contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('mentoros', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
