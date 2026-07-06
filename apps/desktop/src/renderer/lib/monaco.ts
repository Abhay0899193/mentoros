/**
 * Offline-first Monaco wiring (plan.md §5 Editor row) — no CDN, no
 * `@monaco-editor/react`. Imports only the python + javascript basic-language
 * contributions (Monarch tokenizers) to keep the bundle lean; the full
 * TS/JS language-service worker is intentionally skipped — plain
 * tokenization + bracket matching is enough for interview coding, and one
 * editor worker instance covers every label.
 */
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export { monaco };

let workerEnvReady = false;

function ensureWorkerEnv() {
  if (workerEnvReady) return;
  workerEnvReady = true;
  self.MonacoEnvironment = {
    // One plain editor worker for every language label — no per-language
    // (e.g. TS) language-service workers.
    getWorker: () => new EditorWorker(),
  };
}

/**
 * Reads live Nocturne CSS custom properties (theme/tokens.css) for the given
 * theme without a visible flash: toggles `data-theme` on <html> for a single
 * synchronous read, then restores it. Keeps the Monaco theme wired to the
 * actual token registry instead of a second, hand-copied palette.
 */
function readTokens(theme: "dark" | "light") {
  const root = document.documentElement;
  const prev = root.dataset.theme;
  root.dataset.theme = theme;
  const cs = getComputedStyle(root);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const tokens = {
    surface1: v("--surface-1"),
    surface2: v("--surface-2"),
    surface3: v("--surface-3"),
    ink: v("--ink"),
    muted: v("--muted"),
    faint: v("--faint"),
    iris: v("--iris"),
    success: v("--success"),
    warning: v("--warning"),
    danger: v("--danger"),
    info: v("--info"),
  };
  if (prev === undefined) delete root.dataset.theme;
  else root.dataset.theme = prev;
  return tokens;
}

let themesDefined = false;

/**
 * Defines 'nocturne-dark' / 'nocturne-light' Monaco themes from the live
 * token values (§3.0.2: monochrome chrome, restrained color as data — code
 * syntax gets a quiet iris/info/success accent, never saturated chrome).
 * Idempotent; call before creating the first editor instance.
 */
export function defineNocturneThemes() {
  ensureWorkerEnv();
  if (themesDefined) return;
  themesDefined = true;

  (["dark", "light"] as const).forEach((theme) => {
    const t = readTokens(theme);
    monaco.editor.defineTheme(
      theme === "dark" ? "nocturne-dark" : "nocturne-light",
      {
        base: theme === "dark" ? "vs-dark" : "vs",
        inherit: true,
        rules: [
          {
            token: "comment",
            foreground: t.faint.replace("#", ""),
            fontStyle: "italic",
          },
          { token: "keyword", foreground: t.iris.replace("#", "") },
          { token: "string", foreground: t.success.replace("#", "") },
          { token: "number", foreground: t.info.replace("#", "") },
          { token: "type", foreground: t.warning.replace("#", "") },
          { token: "delimiter", foreground: t.muted.replace("#", "") },
          { token: "operator", foreground: t.muted.replace("#", "") },
          { token: "identifier", foreground: t.ink.replace("#", "") },
        ],
        colors: {
          "editor.background": t.surface1,
          "editor.foreground": t.ink,
          "editorLineNumber.foreground": t.faint,
          "editorLineNumber.activeForeground": t.muted,
          "editor.lineHighlightBackground": t.surface2,
          "editor.lineHighlightBorder": "#00000000",
          "editorCursor.foreground": t.iris,
          "editor.selectionBackground": `${t.iris}33`,
          "editor.inactiveSelectionBackground": `${t.iris}1a`,
          "editorIndentGuide.background": t.surface3,
          "editorIndentGuide.activeBackground": t.surface3,
          "editorWhitespace.foreground": t.surface3,
          "editorGutter.background": t.surface1,
          "scrollbarSlider.background": `${t.surface3}aa`,
          "scrollbarSlider.hoverBackground": `${t.surface3}dd`,
          "scrollbarSlider.activeBackground": t.surface3,
          "editorWidget.background": t.surface2,
          "editorWidget.border": t.surface3,
          "editorSuggestWidget.background": t.surface2,
          "editorSuggestWidget.border": t.surface3,
          "editorBracketMatch.background": `${t.iris}22`,
          "editorBracketMatch.border": t.iris,
        },
      },
    );
  });
}
