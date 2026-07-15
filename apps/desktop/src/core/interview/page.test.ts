import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPageMarkdown,
  fetchProblemPage,
  PageExtractError,
  PageFetchError,
  pageTitle,
  PageUrlError,
} from "./page.js";

/* ------------------------------ fixtures ------------------------------- */

const STATEMENT = [
  "<p>Given a sorted dictionary of an alien language having <code>N</code> words, find the order of characters in the alien language.</p>",
  "<p><strong>Example 1:</strong></p>",
  "<pre>Input: N = 5, dict = [\"baa\",\"abcd\",\"abca\",\"cab\",\"cad\"]\nOutput: b d a c</pre>",
  "<ul><li>Expected Time Complexity: O(N)</li><li>1 &lt;= N &lt;= 300</li></ul>",
].join("\n");

function fullPage(bodyInner: string, title = "Alien Dictionary | Practice | GeeksforGeeks"): string {
  return [
    "<!doctype html><html><head>",
    `<title>${title}</title>`,
    "<script>window.__x = 1;</script>",
    "<style>.a{color:red}</style>",
    "</head><body>",
    "<nav><a href='/'>Home</a><a href='/jobs'>Jobs</a><a href='/courses'>Courses</a></nav>",
    "<header><h1>GeeksforGeeks</h1><form><input name='q'/><button>Search</button></form></header>",
    bodyInner,
    "<aside><p>Trending: 100 must-do problems and other links to click through right now</p></aside>",
    "<footer><p>© 2026 GeeksforGeeks. Careers. Privacy. Some very long footer boilerplate text.</p></footer>",
    "</body></html>",
  ].join("\n");
}

/* ------------------------------ pageTitle ------------------------------ */

test("pageTitle: extracts and trims the site-name suffix", () => {
  assert.equal(pageTitle("<title>Alien Dictionary - GeeksforGeeks</title>"), "Alien Dictionary");
  assert.equal(pageTitle("<title>Two Sum | LeetCode Wannabe</title>"), "Two Sum");
  assert.equal(pageTitle("<title>Plain Title</title>"), "Plain Title");
  assert.equal(pageTitle("<html><body>no title</body></html>"), "");
});

/* -------------------------- extractPageMarkdown ------------------------ */

test("extractPageMarkdown: prefers <article> content and drops page chrome", () => {
  const html = fullPage(`<article>${STATEMENT}</article>`);
  const md = extractPageMarkdown(html);
  assert.match(md, /alien language/);
  assert.match(md, /```\nInput: N = 5/);
  assert.match(md, /- Expected Time Complexity: O\(N\)/);
  assert.match(md, /1 <= N <= 300/);
  assert.doesNotMatch(md, /Trending/);
  assert.doesNotMatch(md, /GeeksforGeeks\. Careers/);
  assert.doesNotMatch(md, /window\.__x/);
});

test("extractPageMarkdown: picks the densest of several articles", () => {
  const filler =
    "<p>This related-card article stub has enough text to clear the minimum content bar for a candidate, but it is still much shorter than the real statement below it.</p>";
  const html = fullPage(
    `<article>${filler}</article><article>${STATEMENT}${STATEMENT}</article>`,
  );
  assert.match(extractPageMarkdown(html), /alien language/);
});

test("extractPageMarkdown: falls back to <main>, then <body>", () => {
  const viaMain = fullPage(`<main>${STATEMENT}</main>`);
  assert.match(extractPageMarkdown(viaMain), /alien language/);
  const viaBody = fullPage(`<div class="content">${STATEMENT}</div>`);
  assert.match(extractPageMarkdown(viaBody), /alien language/);
});

test("extractPageMarkdown: skeleton article (cookie card) loses to the body", () => {
  const html = fullPage(`<article><p>Accept cookies?</p></article><div>${STATEMENT}</div>`);
  assert.match(extractPageMarkdown(html), /alien language/);
});

test("extractPageMarkdown: client-rendered empty shell → PageExtractError", () => {
  const shell = "<html><head><title>App</title></head><body><div id='root'></div><script src='app.js'></script></body></html>";
  assert.throws(() => extractPageMarkdown(shell), PageExtractError);
});

test("extractPageMarkdown: very long content is truncated with a marker", () => {
  const long = `<article><p>${"statement text ".repeat(3000)}</p></article>`;
  const md = extractPageMarkdown(fullPage(long));
  assert.ok(md.length < 25_000);
  assert.match(md, /… \(truncated\)$/);
});

/* ---------------------------- fetchProblemPage ------------------------- */

function fakeFetch(status: number, body: string, contentType = "text/html; charset=utf-8") {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

test("fetchProblemPage: happy path returns title + markdown + normalized url", async () => {
  const result = await fetchProblemPage(
    "  https://www.geeksforgeeks.org/problems/alien-dictionary/1 ",
    fakeFetch(200, fullPage(`<article>${STATEMENT}</article>`)),
  );
  assert.equal(result.title, "Alien Dictionary");
  assert.match(result.markdown, /alien language/);
  assert.equal(result.url, "https://www.geeksforgeeks.org/problems/alien-dictionary/1");
});

test("fetchProblemPage: invalid / non-http urls → PageUrlError", async () => {
  await assert.rejects(fetchProblemPage("not a url"), PageUrlError);
  await assert.rejects(fetchProblemPage("ftp://example.com/x"), PageUrlError);
  await assert.rejects(fetchProblemPage("file:///etc/passwd"), PageUrlError);
});

test("fetchProblemPage: non-OK status → PageFetchError with the status", async () => {
  await assert.rejects(
    fetchProblemPage("https://example.com/gone", fakeFetch(403, "denied")),
    (err: unknown) => err instanceof PageFetchError && /403/.test(err.message),
  );
});

test("fetchProblemPage: non-HTML content-type → PageExtractError", async () => {
  await assert.rejects(
    fetchProblemPage(
      "https://example.com/data.json",
      fakeFetch(200, "{}", "application/json"),
    ),
    PageExtractError,
  );
});

test("fetchProblemPage: network failure → PageFetchError", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(fetchProblemPage("https://example.com/x", failing), PageFetchError);
});
