import { Fragment } from 'react';
import { CodeBlock } from '../chat/CodeBlock';

/**
 * Static markdown renderer for the KB reading surface. Unlike `chat/RichText`
 * (deliberately minimal, streaming-safe) this renders a full document once:
 * headings, lists, blockquotes, hr, GFM tables, links and images. Hand-rolled
 * — no markdown dependency, to keep the bundle offline-lean. Malformed input
 * degrades to plain paragraph text; it never throws.
 */

export interface ReadingMarkdownProps {
  text: string;
  /** Called for same-directory / relative links (./foo.md, foo.md — no scheme). */
  onOpenRelative?: (path: string) => void;
}

/* ---------------------------------- inline --------------------------------- */

const INLINE_RE = /(!\[[^\]]*\]\([^\s)]*\)|\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function InlineLink({ label, href, onOpenRelative }: { label: string; href: string; onOpenRelative?: (path: string) => void }) {
  const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const cls = 'text-body underline decoration-line/50 transition-colors hover:decoration-body';
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => onOpenRelative?.(href)} className={cn(cls, 'cursor-pointer bg-transparent p-0')}>
      {label}
    </button>
  );
}

// local, dependency-free cn to avoid importing the shared helper's twMerge cost here
function cn(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function Inline({ text, onOpenRelative }: { text: string; onOpenRelative?: (path: string) => void }) {
  const tokens = text.split(INLINE_RE);
  return (
    <>
      {tokens.map((t, i) => {
        if (!t) return null;

        if (t.startsWith('![')) {
          const m = /^!\[([^\]]*)\]\(([^\s)]*)\)$/.exec(t);
          if (m) {
            return (
              <em key={i} className="text-faint italic">
                {m[1] || 'image'}
              </em>
            );
          }
        }

        if (t.startsWith('[')) {
          const m = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(t);
          if (m) {
            return <InlineLink key={i} label={m[1]} href={m[2]} onOpenRelative={onOpenRelative} />;
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

        if (t.startsWith('*') && t.endsWith('*') && t.length > 1) {
          return (
            <em key={i} className="text-body italic">
              {t.slice(1, -1)}
            </em>
          );
        }

        return <Fragment key={i}>{t}</Fragment>;
      })}
    </>
  );
}

/* ---------------------------------- blocks ---------------------------------- */

type Alignment = 'left' | 'center' | 'right';

interface ListItem {
  text: string;
  children: ListItem[];
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; code: string; lang?: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: string[]; align: Alignment[]; rows: string[][] };

const FENCE_RE = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // split on unescaped pipes
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function alignFromSep(cell: string): Alignment {
  const left = cell.trim().startsWith(':');
  const right = cell.trim().endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

/** Parses non-fenced markdown text (fences are already carved out) into blocks. */
function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      const depth = h[1].length;
      const level = depth <= 1 ? 1 : depth === 2 ? 2 : 3;
      blocks.push({ kind: 'heading', level, text: h[2].trim() });
      i++;
      continue;
    }

    // GFM table: a header row followed immediately by a separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitCells(line);
      const align = splitCells(lines[i + 1]).map(alignFromSep);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
        rows.push(splitCells(lines[j]));
        j++;
      }
      blocks.push({ kind: 'table', header, align, rows });
      i = j;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('>')) {
        quoteLines.push(lines[j].trim().replace(/^>\s?/, ''));
        j++;
      }
      blocks.push({ kind: 'quote', text: quoteLines.join(' ').trim() });
      i = j;
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const items: ListItem[] = [];
      let ordered = false;
      let j = i;
      let current: ListItem | null = null;
      while (j < lines.length) {
        const m = LIST_ITEM_RE.exec(lines[j]);
        if (m) {
          const indent = m[1].length;
          const marker = m[2];
          const itemText = m[3];
          if (indent === 0) {
            current = { text: itemText, children: [] };
            items.push(current);
            ordered = ordered || /\d/.test(marker);
          } else if (current) {
            current.children.push({ text: itemText, children: [] });
          } else {
            current = { text: itemText, children: [] };
            items.push(current);
          }
          j++;
        } else if (lines[j].trim() === '') {
          break;
        } else if (/^\s+\S/.test(lines[j]) && current) {
          // continuation line for the current item
          current.text = `${current.text} ${lines[j].trim()}`;
          j++;
        } else {
          break;
        }
      }
      blocks.push({ kind: 'list', ordered, items });
      i = j;
      continue;
    }

    // paragraph: consume until blank line or a line starting a new block kind
    const paraLines: string[] = [line];
    let j = i + 1;
    while (
      j < lines.length &&
      lines[j].trim() !== '' &&
      !HEADING_RE.test(lines[j]) &&
      !HR_RE.test(lines[j]) &&
      !LIST_ITEM_RE.test(lines[j]) &&
      !lines[j].trim().startsWith('>') &&
      !(lines[j].includes('|') && lines[j + 1] && TABLE_SEP_RE.test(lines[j + 1] ?? ''))
    ) {
      paraLines.push(lines[j]);
      j++;
    }
    blocks.push({ kind: 'para', text: paraLines.join(' ').trim() });
    i = j;
  }

  return blocks;
}

/** Splits fenced code blocks out from the rest so they never get block-parsed. */
function splitFences(text: string): Array<{ kind: 'text' | 'code'; content: string; lang?: string }> {
  const parts: Array<{ kind: 'text' | 'code'; content: string; lang?: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', content: text.slice(last, m.index) });
    parts.push({ kind: 'code', content: m[2], lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', content: text.slice(last) });
  return parts;
}

const HEADING_CLS: Record<1 | 2 | 3, string> = {
  1: 'text-h1 text-ink mt-8 mb-4 first:mt-0',
  2: 'text-h2 text-ink mt-7 mb-3 first:mt-0',
  3: 'text-h3 text-ink mt-6 mb-2 first:mt-0',
};

const ALIGN_CLS: Record<Alignment, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function ListItems({ items, ordered, onOpenRelative }: { items: ListItem[]; ordered: boolean; onOpenRelative?: (p: string) => void }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={cn('my-3 flex flex-col gap-1.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
      {items.map((it, i) => (
        <li key={i} className="text-body leading-relaxed text-body marker:text-faint">
          <Inline text={it.text} onOpenRelative={onOpenRelative} />
          {it.children.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1.5 pl-5 list-disc">
              {it.children.map((child, ci) => (
                <li key={ci} className="text-body leading-relaxed text-body marker:text-faint">
                  <Inline text={child.text} onOpenRelative={onOpenRelative} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </Tag>
  );
}

function Table({ block, onOpenRelative }: { block: Extract<Block, { kind: 'table' }>; onOpenRelative?: (p: string) => void }) {
  return (
    <div className="my-4 overflow-x-auto rounded-[10px] hairline">
      <table className="w-full border-collapse font-mono text-mono">
        <thead>
          <tr className="border-b border-line">
            {block.header.map((cell, i) => (
              <th
                key={i}
                className={cn(
                  'px-3 py-2 text-label font-medium tracking-[0.02em] text-faint uppercase',
                  ALIGN_CLS[block.align[i] ?? 'left'],
                )}
              >
                <Inline text={cell} onOpenRelative={onOpenRelative} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className={ri > 0 ? 'border-t border-line' : undefined}>
              {row.map((cell, ci) => (
                <td key={ci} className={cn('px-3 py-2 text-body', ALIGN_CLS[block.align[ci] ?? 'left'])}>
                  <Inline text={cell} onOpenRelative={onOpenRelative} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Blocks({ blocks, onOpenRelative }: { blocks: Block[]; onOpenRelative?: (p: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return b.level === 1 ? (
              <h1 key={i} className={HEADING_CLS[1]}>
                <Inline text={b.text} onOpenRelative={onOpenRelative} />
              </h1>
            ) : b.level === 2 ? (
              <h2 key={i} className={HEADING_CLS[2]}>
                <Inline text={b.text} onOpenRelative={onOpenRelative} />
              </h2>
            ) : (
              <h3 key={i} className={HEADING_CLS[3]}>
                <Inline text={b.text} onOpenRelative={onOpenRelative} />
              </h3>
            );
          case 'para':
            return (
              <p key={i} className="my-3 text-body leading-relaxed text-body">
                <Inline text={b.text} onOpenRelative={onOpenRelative} />
              </p>
            );
          case 'code':
            return <CodeBlock key={i} code={b.code} lang={b.lang} />;
          case 'quote':
            return (
              <blockquote key={i} className="my-3 border-l-2 border-line-strong pl-4 text-body text-muted italic">
                <Inline text={b.text} onOpenRelative={onOpenRelative} />
              </blockquote>
            );
          case 'hr':
            return <hr key={i} className="my-6 border-t border-line" />;
          case 'list':
            return <ListItems key={i} items={b.items} ordered={b.ordered} onOpenRelative={onOpenRelative} />;
          case 'table':
            return <Table key={i} block={b} onOpenRelative={onOpenRelative} />;
          default:
            return null;
        }
      })}
    </>
  );
}

export function ReadingMarkdown({ text, onOpenRelative }: ReadingMarkdownProps) {
  let parts: Array<{ kind: 'text' | 'code'; content: string; lang?: string }>;
  try {
    parts = splitFences(text);
  } catch {
    parts = [{ kind: 'text', content: text }];
  }

  return (
    <div className="select-text text-body">
      {parts.map((p, i) => {
        if (p.kind === 'code') {
          return <CodeBlock key={i} code={p.content} lang={p.lang} />;
        }
        let blocks: Block[];
        try {
          blocks = parseBlocks(p.content);
        } catch {
          blocks = [{ kind: 'para', text: p.content }];
        }
        return <Blocks key={i} blocks={blocks} onOpenRelative={onOpenRelative} />;
      })}
    </div>
  );
}
