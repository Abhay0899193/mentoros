import type { Segment, SegmentBlock } from "./types.js";

/**
 * Teaching-posture stream parser.
 *
 * The model is instructed to emit its answer as sections delimited by literal
 * marker lines (`<<<HINT1>>>`, `<<<HINT2>>>`, `<<<APPROACH>>>`, `<<<SOLUTION>>>`).
 * Everything before the first marker is `prose`; after a marker, text belongs to
 * that section. This class consumes the token stream chunk-by-chunk, strips the
 * marker lines, and routes text to the correct {@link Segment} — correctly
 * handling markers that straddle chunk boundaries.
 *
 * It intentionally holds back any trailing bytes that could be the prefix of a
 * marker until the next chunk (or {@link flush}) disambiguates them, so a marker
 * split across two chunks is never leaked into the output.
 */

const MARKERS: ReadonlyArray<{ marker: string; segment: Segment }> = [
  { marker: "<<<HINT1>>>", segment: "hint1" },
  { marker: "<<<HINT2>>>", segment: "hint2" },
  { marker: "<<<APPROACH>>>", segment: "approach" },
  { marker: "<<<SOLUTION>>>", segment: "solution" },
];

const MAX_MARKER_LEN = Math.max(...MARKERS.map((m) => m.marker.length));

const CANONICAL_ORDER: Segment[] = [
  "prose",
  "hint1",
  "hint2",
  "approach",
  "solution",
];

export interface EmittedToken {
  segment: Segment;
  token: string;
}

/**
 * Longest suffix of `s` that is a (proper or full) prefix of some marker.
 * We hold these bytes back because the next chunk might complete a marker.
 */
function suffixMarkerHoldback(s: string): number {
  const max = Math.min(s.length, MAX_MARKER_LEN);
  for (let k = max; k > 0; k -= 1) {
    const suffix = s.slice(s.length - k);
    if (MARKERS.some((m) => m.marker.startsWith(suffix))) return k;
  }
  return 0;
}

/** Earliest complete marker in `s`, or null. */
function firstMarker(
  s: string,
): { index: number; marker: string; segment: Segment } | null {
  let best: { index: number; marker: string; segment: Segment } | null = null;
  for (const { marker, segment } of MARKERS) {
    const idx = s.indexOf(marker);
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, marker, segment };
    }
  }
  return best;
}

export class TeachingSegmenter {
  private current: Segment = "prose";
  private buffer = "";
  private readonly acc = new Map<Segment, string>();

  /**
   * Feed a chunk of streamed text. Returns the tokens safe to emit now, each
   * tagged with the segment they belong to (marker lines already stripped).
   */
  push(text: string): EmittedToken[] {
    this.buffer += text;
    const emitted: EmittedToken[] = [];

    // Consume every complete marker currently in the buffer.
    for (;;) {
      const hit = firstMarker(this.buffer);
      if (!hit) break;
      const before = this.buffer.slice(0, hit.index);
      if (before.length > 0) this.record(before, emitted);
      this.current = hit.segment;
      // Drop the marker plus one immediately-following newline (markers sit on
      // their own line, so the trailing newline is formatting, not content).
      let rest = this.buffer.slice(hit.index + hit.marker.length);
      if (rest.startsWith("\r\n")) rest = rest.slice(2);
      else if (rest.startsWith("\n")) rest = rest.slice(1);
      this.buffer = rest;
    }

    // Emit everything except a trailing partial-marker candidate.
    const holdback = suffixMarkerHoldback(this.buffer);
    const safe = this.buffer.slice(0, this.buffer.length - holdback);
    if (safe.length > 0) this.record(safe, emitted);
    this.buffer = this.buffer.slice(this.buffer.length - holdback);

    return emitted;
  }

  /** Flush any buffered tail (called once the stream ends). */
  flush(): EmittedToken[] {
    const emitted: EmittedToken[] = [];
    if (this.buffer.length > 0) {
      this.record(this.buffer, emitted);
      this.buffer = "";
    }
    return emitted;
  }

  private record(text: string, out: EmittedToken[]): void {
    this.acc.set(this.current, (this.acc.get(this.current) ?? "") + text);
    out.push({ segment: this.current, token: text });
  }

  /**
   * Canonical, trimmed segments accumulated so far. Empty sections are dropped.
   * Call after {@link flush} to persist the final message.
   */
  segments(): SegmentBlock[] {
    const blocks: SegmentBlock[] = [];
    for (const segment of CANONICAL_ORDER) {
      const content = (this.acc.get(segment) ?? "").trim();
      if (content.length > 0) blocks.push({ segment, content });
    }
    return blocks;
  }
}
