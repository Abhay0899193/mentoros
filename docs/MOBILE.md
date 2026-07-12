# MentorOS on iPhone (14 Pro Max) — options research

*Researched 2026-07-12. Context: user asked how to use MentorOS on an iPhone 14 Pro Max (A16, 6 GB RAM, iOS Safari/WebKit).*

## ✅ Shipped — Options A + B (2026-07-12)

**No deployment, no domain.** Your Mac serves the app; the phone is a browser.
(The earlier `http://<mac-ip>:5173` attempt failed because the vite page then
called `http://127.0.0.1:4820` — the phone itself — and the core only allowed
localhost origins. Both problems are gone: the core now serves the renderer
itself, same-origin.)

### How to use it (home Wi-Fi)

1. Settings → **Connectivity** → turn on **Allow other devices**.
2. **Restart MentorOS** (the network binding is chosen at boot; `MENTOROS_LAN=1`
   env also forces it on).
3. Open the URL shown in Connectivity on the phone —
   `http://<mac-ip>:4820/?token=<token>`. The token is required off-loopback
   (the DB holds chats + API keys); the first visit stores it as a cookie, so
   subsequent visits/WS/asset loads just work. Treat the link like a password.
4. Everything works except the **mic** — Safari requires HTTPS for
   `getUserMedia`. For voice, use Tailscale (below).

### How to use it anywhere + voice (Tailscale, free, no domain)

1. Install [Tailscale](https://tailscale.com) on the Mac and the iPhone, sign
   both into the same tailnet (free personal tier).
2. On the Mac: `tailscale serve --bg 4820` (once; it persists). This
   reverse-proxies `https://<mac-name>.<tailnet>.ts.net` → the core with a real
   Let's Encrypt certificate.
3. On the phone open `https://<mac-name>.<tailnet>.ts.net` — full app **including
   the voice loop**, over any network incl. LTE. No token needed on this path:
   `tailscale serve` arrives via loopback (exempt by design) and the tailnet
   ACL is the auth. Nothing is exposed to the public internet.
4. Add to Home Screen for an app-like full-screen launch (PWA manifest polish
   is still a backlog item — Option C below).

### What shipped where (for future maintainers)

- Core: `lanAccess` setting (+`MENTOROS_LAN` env) → bind `0.0.0.0` at boot;
  built renderer served same-origin from `out/renderer`; shared token
  `keys.lanToken` enforced via an onRequest hook (loopback exempt — Electron and
  tailscale-serve are frictionless; `?token=` → cookie handshake covers assets,
  fetch, and WS upgrades); loopback-only `GET /network/access-info` feeds the
  Connectivity UI.
- Renderer: `coreClient` derives base/WS URLs from `window.location` when the
  page is served over http(s) without `?corePort` (wss follows https →
  Tailscale voice works); Settings → Connectivity section.
- Dev note: the phone always gets the **built** renderer — run a build to
  refresh what it sees. Opening the bare vite URL in a plain browser now needs
  `?corePort=4820` appended.
- Manual test script: `MANUAL_TEST_CHECKLIST.md` §9.

## The architectural head start

The §2.2 boundary was built for exactly this. The core is a plain Fastify server
(`src/core/`, zero `electron` imports) and the renderer is a plain Vite React
web app that talks to it only through `lib/coreClient.ts` (HTTP + WS). Nothing
in the renderer touches Node APIs. That means the web app already *runs* in any
modern browser — the work is serving, networking, and mobile ergonomics, not a
rewrite.

What can never run on the phone itself: the sidecars (Ollama, whisper.cpp,
Kokoro TTS, mflux, mlx-video are all macOS/MLX/GPU-bound). Every option below
keeps the Mac (or a future cloud box) as the brain; the phone is a screen +
mic.

## Option A — LAN web app (Mac serves, Safari browses) · smallest step

Serve the built renderer + core over the local network; open
`http://<mac-ip>:4820` on the phone.

Code changes needed (all small, found in this repo):
1. **Bind beyond loopback** — `src/core/server.ts:41` pins `HOST = "127.0.0.1"`.
   Needs an opt-in flag/env (e.g. `MENTOROS_LAN=1` → `0.0.0.0`).
2. **CORS** — `server.ts:104` allows only `localhost`/`127.0.0.1`/`null`
   origins. LAN IP origins must be added (or skip CORS entirely by serving the
   renderer *from the core*, same-origin — cleanest).
3. **Static renderer route** — core gains `GET /` serving `out/renderer/`
   (fastify-static or the existing hand-rolled streaming idiom). Same-origin
   kills both the CORS and the discovery problem.
4. **Client base URL** — `coreClient.ts:1563` hardcodes
   `http://127.0.0.1:${port}`; must derive from `window.location` when not
   running inside Electron.
5. **Auth** — anything beyond loopback needs at least a shared token; the DB
   holds chats + API keys.

Caveats:
- **Mic (voice loop) will NOT work over plain HTTP** — Safari requires a
  secure context for `getUserMedia`. Chat/studio/interviews work; voice needs
  Option B's HTTPS (or a self-signed cert the phone trusts).
- Mac must be awake, on the same Wi-Fi.
- Touch ergonomics: hold-Space PTT and ⌘K need touch equivalents eventually.

**Effort: ~1 short slice.** Best first step; everything else builds on it.

## Option B — Tailscale + HTTPS ("MentorOS Anywhere") · recommended target

Same serving work as A, plus [Tailscale](https://tailscale.com) (free personal
tier) on Mac + iPhone:

- Phone reaches the Mac from anywhere (LTE included), not just home Wi-Fi —
  WireGuard tunnel, no port forwarding, nothing exposed to the internet.
- `tailscale serve` reverse-proxies `https://<mac>.<tailnet>.ts.net` → core
  with a **real Let's Encrypt certificate** — this is what unlocks the mic in
  Safari, so the full voice loop works on the phone.
- Tailnet ACLs are the auth story for a personal deployment (still add the
  token from A as defense in depth).

**Effort: A + a settings toggle + docs.** No App Store, no Apple fees, private
by construction. This is the recommended path.

## Option C — PWA polish (on top of A/B)

`manifest.webmanifest` (name, icons, `display: standalone`, dark
`theme_color`), apple-touch-icon, `viewport-fit=cover` + safe-area insets, and
a minimal service worker for shell caching. "Add to Home Screen" then gives a
full-screen, app-like MentorOS with its own icon — no browser chrome. iOS PWAs
also get Web Push (iOS 16.4+) if notifications are ever wanted.

**Effort: 1–2 days, pure polish.** Do it with B; skip the service worker's
offline story (the app is useless without the core anyway).

## Option D — Native shell (Capacitor / SwiftUI WKWebView) · later, optional

Wrap the same renderer in a WKWebView (Capacitor is the low-effort route; the
renderer needs zero changes beyond A). Gains over a PWA: App Store/TestFlight
distribution, better audio-session control (background audio, interruption
handling), native share sheet, haptics. Costs: Apple Developer account
($99/yr), build pipeline, review friction. The renderer still talks to the
Mac/cloud core.

**Verdict: not worth it until the PWA shows real friction.**

## Option E — On-device inference · not feasible as-is

The A16 + 6 GB RAM can run *small* models (llama 3B q4 via llama.cpp, whisper
small via whisper.cpp iOS builds) but none of the current stack: llama3.1:8b,
LTX-2.3 22B, Z-Image-Turbo, and Kokoro are Mac/MLX-bound and far over the
phone's memory budget. An on-device MentorOS would be a ground-up rebuild with
much weaker models. The honest mobile-local story is "wait for the SaaS/cloud
phase": move the core to a rented GPU box (or swap sidecars for cloud APIs —
the router already supports Anthropic models, and imagegen already has a fal.ai
adapter), then any device is first-class.

## Option F — Remote desktop stopgap · zero code

Screens/Jump/RustDesk to the Mac from the phone. Works today, feels like a
desktop squeezed onto 6.7", no mobile UX. Fine for an emergency check-in, not
a real answer.

## Recommendation

1. **Now:** Option A slice (serve renderer from core, LAN flag, base-URL
   derivation, shared token) —
2. **Same slice or next:** Option B (Tailscale serve → HTTPS → mic works,
   works over LTE) + Option C manifest polish. That's a genuinely usable
   MentorOS on the iPhone with every feature except things that need the
   keyboard.
3. **Later:** revisit D only if the PWA chafes; E belongs to the cloud/SaaS
   phase of plan.md.
