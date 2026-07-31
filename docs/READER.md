# MentorOS Reader — study on the phone, laptop closed

The Reader is the read-only half of MentorOS: every study guide, quick-review
sheet, day note and the 3mc plan, published as a static site you can open on
your phone in ten spare minutes. No laptop awake, no Tailscale, no signal
needed after the first open.

It is **write-free by design**. Ticking tasks off, running code, chat, voice and
anything AI stays in the desktop app — those need the core, and the core needs
the Mac.

---

## Publishing, in three commands

```bash
cd apps/desktop
pnpm reader:export     # 3mc tree (+ the running app, if it is) → content.json
pnpm reader:build      # static site → apps/desktop/out/reader
pnpm reader:publish    # both of the above, then deploys to Vercel
```

`pnpm reader:publish` does all three. Run it whenever new guides are written;
the phone picks the new bundle up the next time it's online.

**Leave the desktop app running when you export.** The exporter asks it for your
week/day progress and read ticks over `http://127.0.0.1:4820`. If it's not
running the bundle still publishes, just without the ticks (the Plan screen says
so out loud).

## First-time Vercel setup

1. `npx vercel login` — once, on this Mac.
2. `pnpm reader:publish` — the CLI asks a couple of questions the first time
   (create a new project? scope?). Say yes, pick a name like `mentoros-reader`.
   It prints a `https://….vercel.app` URL.
3. On the iPhone: open that URL in Safari → Share → **Add to Home Screen**.

From then on `pnpm reader:publish` redeploys to the same URL and the home-screen
icon just has newer content.

## Why not connect the GitHub repo to Vercel?

You can — Vercel only builds and serves what you point it at, so the rest of the
repo would never be published. We deploy the built folder from the CLI anyway,
for two blunter reasons:

- **The bundle is your notes, not source.** `content.json` is your entire study
  library. This repo is **public on GitHub**, and the 3mc repo isn't in git at
  all. Building locally and uploading the result keeps your notes out of git
  while still getting them onto the phone. `content.json` is in `.gitignore`.
- **No build on Vercel, nothing to configure.** Vercel receives a folder of
  static files. No install step, no Node version, no secrets, nothing that can
  break on their side.

## What lands on the internet

A Vercel Hobby URL is **public** — password protection is a paid feature. What
gets published is the study material only:

- study guides (`STUDY-GUIDES/**`, minus `RULES.md`),
- quick-review skill sheets (`SKILLS-TRACK/*.md`),
- day notes (`PHASE-*/week-*/day-*.md`),
- the plan skeleton (weeks, days, task titles and links),
- day-level completion counts, when the app was running.

Deliberately **not** published: your memory/profile records, chat and interview
history, scorecards, API keys, settings — the exporter never reads them.

If that's still more than you want on a public URL, the options are a paid
Vercel plan (password protection), or keeping the URL unguessable and treating
it as unlisted.

## Free tier, honestly

The Reader is ~6 MB of static files (of which ~2 MB is the content bundle, about
500 KB over the wire gzipped) and it makes no server requests at all. Vercel's
Hobby plan is free for personal, non-commercial use with far more bandwidth than
one phone can spend. Nothing here can accrue a bill, because nothing runs
server-side.

The rest of MentorOS **cannot** run on that plan at any price of effort — the
core is a long-lived Fastify process with WebSockets, a SQLite file it writes
to, and subprocesses (Ollama, whisper, the code runner). Serverless has none of
those. That's why the split exists.

## Offline

A small service worker (`src/reader/public/sw.js`) caches the app shell and the
content bundle on first open, so later opens work with no network — Tube,
plane, dead zone. The page and `content.json` are fetched network-first, so a
republish shows up as soon as you're online again; everything else is
cache-first because Vite's filenames are content-hashed.

## What's inside

| Path | What it is |
| --- | --- |
| `tools/reader-export.mts` | Walks the 3mc tree, reuses the app's own frontmatter/tag/plan parsers, asks the running core for progress, writes `content.json`. |
| `apps/desktop/src/reader/` | The static app: Today / Library / Plan / reading view, plus PWA manifest, icons and service worker. |
| `apps/desktop/vite.reader.config.ts` | Plain Vite build (`base: './'`), output `apps/desktop/out/reader`. |

The Reader shares the desktop renderer's design system and markdown renderer by
importing them directly (`../renderer/theme`, `../renderer/app/screens/knowledge/ReadingMarkdown`),
so guides look the same in both, mermaid included. It never imports
`coreClient` — there is no core to talk to.

## Local check

```bash
cd apps/desktop
pnpm reader:export && pnpm reader:build
pnpm reader:preview          # http://localhost:4173
```

Drive it at phone size with Chrome's device emulation; the layout is verified at
390×844 with touch emulation, dark and light.
