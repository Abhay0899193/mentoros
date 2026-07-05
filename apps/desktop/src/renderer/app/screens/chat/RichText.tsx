import { Fragment, memo } from 'react';
import { CodeBlock } from './CodeBlock';

/**
 * Minimal streaming-safe renderer: paragraphs, fenced code blocks, inline
 * code and **bold**. Deliberately not a full markdown engine — keeps the
 * streaming path cheap (60fps budget) and the bundle offline-lean.
 */

interface Part {
  kind: 'text' | 'code';
  content: string;
  lang?: string;
}

function splitFences(text: string): Part[] {
  const parts: Part[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', content: text.slice(last, m.index) });
    parts.push({ kind: 'code', content: m[2], lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', content: text.slice(last) });
  return parts;
}

/** Inline: `code`, **bold**, and — for grounded answers — [n] citation markers. */
function Inline({ text, citedNs }: { text: string; citedNs?: ReadonlySet<number> }) {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\d{1,2}\])/g);
  return (
    <>
      {tokens.map((t, i) => {
        if (citedNs && /^\[\d{1,2}\]$/.test(t)) {
          const n = Number(t.slice(1, -1));
          if (citedNs.has(n)) {
            return (
              <sup
                key={i}
                className="mx-0.5 inline-flex h-[15px] min-w-[15px] translate-y-[-1px] items-center justify-center rounded-full border border-line bg-surface-2 px-1 font-mono text-[10px] leading-none text-muted"
              >
                {n}
              </sup>
            );
          }
        }
        if (t.startsWith('`') && t.endsWith('`') && t.length > 1) {
          return (
            <code key={i} className="rounded-[6px] bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-ink">
              {t.slice(1, -1)}
            </code>
          );
        }
        if (t.startsWith('**') && t.endsWith('**') && t.length > 3) {
          return (
            <strong key={i} className="font-semibold text-ink">
              {t.slice(2, -2)}
            </strong>
          );
        }
        return <Fragment key={i}>{t}</Fragment>;
      })}
    </>
  );
}

function StreamWords({
  text,
  streaming,
  citedNs,
}: {
  text: string;
  streaming: boolean;
  citedNs?: ReadonlySet<number>;
}) {
  if (!streaming) return <Inline text={text} citedNs={citedNs} />;
  // Per-word fade-in (§3.4). Index keys are stable: streamed text only appends.
  const words = text.split(/(\s+)/);
  return (
    <>
      {words.map((w, i) =>
        /^\s*$/.test(w) ? (
          <Fragment key={i}>{w}</Fragment>
        ) : (
          <span key={i} className="word-in">
            <Inline text={w} citedNs={citedNs} />
          </span>
        ),
      )}
    </>
  );
}

export interface RichTextProps {
  text: string;
  /** True only for the message currently being generated. */
  streaming?: boolean;
  showCaret?: boolean;
  onExplainLine?: (line: string) => void;
  /** Citation numbers with a real source behind them — bare [n] otherwise renders as text. */
  citedNs?: ReadonlySet<number>;
}

export const RichText = memo(function RichText({
  text,
  streaming = false,
  showCaret = false,
  onExplainLine,
  citedNs,
}: RichTextProps) {
  const parts = splitFences(text);
  const lastTextIdx = parts.reduce((acc, p, i) => (p.kind === 'text' ? i : acc), -1);

  return (
    <div className="text-body leading-relaxed select-text">
      {parts.map((p, i) =>
        p.kind === 'code' ? (
          <CodeBlock key={i} code={p.content} lang={p.lang} onExplainLine={onExplainLine} />
        ) : (
          <div key={i} className="whitespace-pre-wrap">
            <StreamWords text={p.content} streaming={streaming} citedNs={citedNs} />
            {showCaret && i === lastTextIdx && (
              <span className="caret-pulse ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] rounded-full bg-iris" />
            )}
          </div>
        ),
      )}
      {showCaret && lastTextIdx === -1 && (
        <span className="caret-pulse inline-block h-[1.1em] w-[2px] rounded-full bg-iris" />
      )}
    </div>
  );
});
