/**
 * nativeBridge — typed access to shell-only capabilities exposed by the
 * preload script. Everything here is optional by design: in a browser or
 * mobile shell `window.mentoros` is absent and callers get a graceful null,
 * keeping the renderer shell-agnostic (§2.2).
 */

interface MentorosBridge {
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    mentoros?: MentorosBridge;
  }
}

/** Absolute path of a dragged-in File, or null outside the desktop shell. */
export function pathForFile(file: File): string | null {
  try {
    return window.mentoros?.getPathForFile(file) ?? null;
  } catch {
    return null;
  }
}
