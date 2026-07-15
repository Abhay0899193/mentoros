import type { PageFetchResult } from "../types.js";
import { htmlToMarkdown } from "./leetcode.js";

/**
 * Generic problem-page import (§ Phase H). Fetches an arbitrary article URL
 * (GeeksforGeeks, blogs, contest archives…) and reduces it to markdown-ish
 * text the problem importer can draft from. Extraction is deterministic and
 * heuristic — the user always reviews/trims the result in the paste box, so
 * "good enough main content" beats a heavy readability dependency.
 *
 * Client-rendered sites (e.g. neetcode.io) ship an empty HTML shell; those
 * fail the minimum-content guard with a paste-instead message by design.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
/** Cap on extracted markdown — the draft LLM doesn't benefit past this. */
const MAX_MARKDOWN_CHARS = 24_000;
/** Below this the page almost certainly rendered client-side / was chrome only. */
const MIN_MARKDOWN_CHARS = 120;

/** Thrown when the URL itself is unusable (→ HTTP 400). */
export class PageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageUrlError";
  }
}

/** Thrown when the page fetched but no readable statement emerged (→ HTTP 422). */
export class PageExtractError extends Error {
  constructor(
    message = "Couldn't find a readable statement on that page — it may render in the browser only. Paste the text instead.",
  ) {
    super(message);
    this.name = "PageExtractError";
  }
}

/** Thrown on network failure / timeout / non-OK status (→ HTTP 502). */
export class PageFetchError extends Error {
  constructor(message = "could not fetch that page") {
    super(message);
    this.name = "PageFetchError";
  }
}

/* ------------------------------- extraction ------------------------------ */

/** Tags whose entire subtree is page chrome or non-content — dropped first. */
const DROP_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
];

function dropTag(html: string, tag: string): string {
  // Non-greedy paired form first, then any stray self-closing/unclosed opener.
  return html
    .replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi"), " ")
    .replace(new RegExp(`<${tag}[^>]*/?>`, "gi"), " ");
}

function stripChrome(html: string): string {
  let work = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROP_TAGS) work = dropTag(work, tag);
  return work;
}

function textLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function matchAll(html: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[\\s>][^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1] ?? "");
  return out;
}

/** The page <title>, cleaned of the usual " | Site" / " - Site" suffix. */
export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return "";
  const raw = htmlToMarkdown(m[1] ?? "").replace(/\s+/g, " ").trim();
  // Pipe segments are always site chrome ("X | Practice | GfG") — keep the
  // first. Dashes appear inside real titles, so only trim a space-padded
  // trailing " - Site" segment.
  const first = (raw.split(/\s*\|\s*/)[0] ?? "").trim() || raw;
  return first.replace(/\s+[–—-]\s+[^–—-]{0,60}$/, "").trim() || first;
}

/**
 * Reduce a fetched HTML document to markdown: strip chrome subtrees, prefer
 * the densest `<article>`, then `<main>`, then `<body>`, and run the fragment
 * through the shared {@link htmlToMarkdown}. Throws {@link PageExtractError}
 * when what remains is too short to be a problem statement.
 */
export function extractPageMarkdown(html: string): string {
  const cleaned = stripChrome(typeof html === "string" ? html : "");

  let fragment: string | undefined;
  for (const tag of ["article", "main"]) {
    const candidates = matchAll(cleaned, tag);
    if (candidates.length > 0) {
      const densest = candidates.reduce((a, b) => (textLength(b) > textLength(a) ? b : a));
      // A skeleton <article> (cookie card, empty app shell) shouldn't win over body.
      if (textLength(densest) >= MIN_MARKDOWN_CHARS) {
        fragment = densest;
        break;
      }
    }
  }
  if (fragment === undefined) {
    fragment = matchAll(cleaned, "body")[0] ?? cleaned;
  }

  const markdown = htmlToMarkdown(fragment);
  if (markdown.length < MIN_MARKDOWN_CHARS) throw new PageExtractError();
  return markdown.length > MAX_MARKDOWN_CHARS
    ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n… (truncated)`
    : markdown;
}

/* --------------------------------- fetch --------------------------------- */

function parsePageUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new PageUrlError("that's not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PageUrlError("only http(s) URLs can be imported");
  }
  return parsed;
}

/**
 * Fetch an arbitrary problem/article page and extract its statement as
 * markdown. Throws {@link PageUrlError} (→400), {@link PageExtractError}
 * (→422) or {@link PageFetchError} (→502). `fetchImpl` is injectable for
 * tests (default: global fetch).
 */
export async function fetchProblemPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PageFetchResult> {
  const parsed = parsePageUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetchImpl(parsed.toString(), {
      redirect: "follow",
      headers: {
        // Some publishers 403 the default undici UA; a plain browser-ish pair passes.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new PageFetchError(`the site returned ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml/i.test(type)) {
      throw new PageExtractError("that URL isn't an HTML page — paste the statement instead.");
    }
    html = await res.text();
    if (html.length > MAX_RESPONSE_BYTES) html = html.slice(0, MAX_RESPONSE_BYTES);
  } catch (err) {
    if (err instanceof PageFetchError || err instanceof PageExtractError) throw err;
    throw new PageFetchError(
      err instanceof Error && err.name === "AbortError" ? "the page request timed out" : undefined,
    );
  } finally {
    clearTimeout(timer);
  }

  return {
    title: pageTitle(html),
    markdown: extractPageMarkdown(html),
    url: parsed.toString(),
  };
}
