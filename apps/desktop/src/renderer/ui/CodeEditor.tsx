import { useEffect, useRef } from "react";
import { monaco, defineNocturneThemes } from "../lib/monaco";
import { useTheme } from "../theme/ThemeProvider";
import { cn } from "../lib/cn";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: "python" | "javascript";
  readOnly?: boolean;
  /** ⌘/Ctrl+Enter — "Run tests" in the interview toolbar. */
  onRun?: () => void;
  className?: string;
}

const monacoThemeName = (theme: "dark" | "light") =>
  theme === "dark" ? "nocturne-dark" : "nocturne-light";

/**
 * Offline Monaco primitive (plan.md §4.5 / §5). Creates/disposes a
 * standalone editor instance, follows the app theme, layouts via
 * ResizeObserver (no automaticLayout polling), and wires ⌘/Ctrl+Enter to
 * `onRun`. Value sync is controlled-ish: external `value` changes (e.g.
 * loading starter code) push into the model only when they don't already
 * match, so typing never gets clobbered mid-keystroke.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  onRun,
  className,
}: CodeEditorProps) {
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current) return;
    defineNocturneThemes();

    const editor = monaco.editor.create(hostRef.current, {
      value,
      language,
      theme: monacoThemeName(theme),
      readOnly: !!readOnly,
      automaticLayout: false,
      fontFamily:
        "'JetBrains Mono Variable', ui-monospace, 'SF Mono', monospace",
      fontLigatures: true,
      fontSize: 13,
      lineHeight: 21,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 16, bottom: 16 },
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      tabSize: 4,
      lineNumbersMinChars: 3,
      cursorBlinking: "smooth",
    });
    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });

    const ro = new ResizeObserver(() => editor.layout());
    ro.observe(hostRef.current);

    return () => {
      changeSub.dispose();
      ro.disconnect();
      editor.dispose();
      editorRef.current = null;
    };
    // Recreated only when the label changes (fixed per session in practice);
    // value/theme/readOnly are synced by the effects below instead.
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName(theme));
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !!readOnly });
  }, [readOnly]);

  return <div ref={hostRef} className={cn("size-full", className)} />;
}
