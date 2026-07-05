/**
 * Chunker — splits source text into ~800-char chunks with ~150-char overlap,
 * preferring paragraph/heading/sentence boundaries over mid-sentence cuts so
 * retrieved excerpts read as coherent passages.
 *
 * Provenance is carried per chunk:
 *   - markdown: the nearest preceding heading becomes `section`
 *   - pdf:      page breaks (form-feed `\f`, inserted by the extractor) become
 *               `p. N` section markers
 *   - txt:      no section
 */

export const TARGET_CHARS = 800;
export const OVERLAP_CHARS = 150;

export type ChunkFormat = "md" | "txt" | "pdf";

export interface Chunk {
  text: string;
  section?: string;
  ord: number;
}

interface Unit {
  text: string;
  section?: string;
  /** Markdown heading unit — a natural hard boundary between chunks. */
  isHeading?: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Split raw text into paragraph units, tagging each with its section. */
function toUnits(raw: string, format: ChunkFormat): Unit[] {
  const text = raw.replace(/\r\n?/g, "\n");
  if (format === "pdf") return pdfUnits(text);
  if (format === "md") return markdownUnits(text);
  return plainUnits(text);
}

function splitParagraphs(block: string): string[] {
  return block
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+$/g, "").replace(/^\s+/g, ""))
    .filter((p) => p.length > 0);
}

function plainUnits(text: string): Unit[] {
  return splitParagraphs(text).map((t) => ({ text: t }));
}

function pdfUnits(text: string): Unit[] {
  const units: Unit[] = [];
  const pages = text.split("\f");
  pages.forEach((page, i) => {
    const section = `p. ${i + 1}`;
    for (const p of splitParagraphs(page)) units.push({ text: p, section });
  });
  return units;
}

function markdownUnits(text: string): Unit[] {
  const units: Unit[] = [];
  let currentSection: string | undefined;
  // Split on blank lines but keep heading lines as their own units so headings
  // stay searchable and update the running section.
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    const lines = trimmed.split("\n");
    const headingLine = lines[0].match(HEADING_RE);
    if (headingLine) {
      // A heading (with or without trailing body) opens a new section and acts
      // as a hard chunk boundary.
      currentSection = headingLine[2].trim();
      units.push({ text: trimmed, section: currentSection, isHeading: true });
      continue;
    }
    units.push({ text: trimmed, section: currentSection });
  }
  return units;
}

const SENTENCE_END = /[.!?]["')\]]?\s+/g;

/** Split an oversized paragraph into sentence-grouped pieces ≤ TARGET_CHARS. */
function splitLongUnit(unit: Unit): Unit[] {
  if (unit.text.length <= TARGET_CHARS) return [unit];
  const sentences: string[] = [];
  let last = 0;
  for (const m of unit.text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    sentences.push(unit.text.slice(last, end).trim());
    last = end;
  }
  if (last < unit.text.length) sentences.push(unit.text.slice(last).trim());

  const pieces: Unit[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim().length) pieces.push({ text: buf.trim(), section: unit.section });
    buf = "";
  };
  for (const s of sentences) {
    if (s.length > TARGET_CHARS) {
      // A single monster sentence: hard-slice on word boundaries.
      flush();
      for (let i = 0; i < s.length; i += TARGET_CHARS) {
        pieces.push({ text: s.slice(i, i + TARGET_CHARS).trim(), section: unit.section });
      }
      continue;
    }
    if (buf.length + s.length + 1 > TARGET_CHARS) flush();
    buf += (buf ? " " : "") + s;
  }
  flush();
  return pieces.length ? pieces : [unit];
}

/**
 * Take the trailing ~OVERLAP_CHARS of a chunk, trimmed forward to a clean
 * sentence (preferred) or word boundary so the overlap reads as a fresh start.
 */
function overlapTail(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text.trim();
  let tail = text.slice(text.length - OVERLAP_CHARS);
  const sent = tail.search(/[.!?]["')\]]?\s+/);
  if (sent !== -1 && sent < OVERLAP_CHARS - 20) {
    tail = tail.slice(sent).replace(/^[.!?"')\]\s]+/, "");
  } else {
    const sp = tail.indexOf(" ");
    if (sp !== -1) tail = tail.slice(sp + 1);
  }
  return tail.trim();
}

/**
 * Chunk `raw` text. Chunks break on paragraph boundaries; when a boundary would
 * overshoot TARGET_CHARS the current chunk is flushed and the next one is seeded
 * with a sentence-aligned overlap of the previous chunk. Oversized paragraphs
 * are pre-split by sentence. `section` reflects the first non-overlap paragraph
 * in the chunk.
 */
export function chunkText(raw: string, opts: { format?: ChunkFormat } = {}): Chunk[] {
  const format = opts.format ?? "txt";
  const units = toUnits(raw, format).flatMap(splitLongUnit);
  if (units.length === 0) return [];

  const chunks: Chunk[] = [];
  let ord = 0;
  let buf = "";
  let bufSection: string | undefined;
  let sectionPending = false; // buffer currently holds only an overlap tail

  const flush = () => {
    const text = buf.trim();
    if (text.length === 0) return;
    chunks.push({ text, section: bufSection, ord: ord++ });
  };

  for (const unit of units) {
    // A markdown heading starts a fresh chunk (clean semantic boundary).
    if (unit.isHeading && buf.trim().length > 0) {
      flush();
      buf = "";
      bufSection = unit.section;
      sectionPending = false;
    }
    const addLen = (buf ? 2 : 0) + unit.text.length;
    if (buf && buf.length + addLen > TARGET_CHARS) {
      flush();
      const tail = overlapTail(buf);
      buf = tail;
      // The overlap keeps the previous section as a fallback, but the next real
      // paragraph re-labels the chunk.
      sectionPending = true;
    }
    if (!buf || sectionPending) {
      bufSection = unit.section ?? bufSection;
      sectionPending = false;
    }
    buf += (buf ? "\n\n" : "") + unit.text;
  }
  flush();
  return chunks;
}
