# Responsive conventions (MentorOS)

The renderer is served to phones as well as Electron (see `docs/MOBILE.md`), so
every screen must survive from a 320px phone up to a wide desktop window. This
is the shared rulebook — the Nocturne invariants (`plan.md` §3.0) hold at every
width; they are not relaxed on small screens.

## Breakpoints

Tailwind defaults, no custom scale. Two of them are load-bearing:

| Width | Shell behaviour |
| --- | --- |
| `< md` (768) | **Phone.** No Rail — a bottom tab bar (Home/Chat/Voice/More). Overlays become bottom sheets. Single column. |
| `md … lg` (768–1023) | **Tablet.** Rail returns (collapsed). Context panel is still a drawer. |
| `≥ lg` (1024) | **Desktop.** Rail · canvas · context panel, the original three columns. |

Mobile-first is **not** the house style here — the desktop layout is the base
and small screens are the override — because the existing code is desktop-shaped
and inverting it would touch every line. Write the desktop layout as the
unprefixed classes and add the *narrow* behaviour with `max-*` where needed, or
(preferred) restructure so the narrow case is the base and `md:`/`lg:` restore
the wide case. Either is fine; do not mix them inside one component.

## The rules

1. **No hardcoded width may exceed ~320px without a narrow fallback.**
   `w-[520px]` → `w-full md:w-[520px]`. `min-w-[340px]` → `md:min-w-[340px]`.
   A fixed `min-w-*` is the single most common cause of horizontal page scroll:
   it cannot shrink, so it pushes the body wider than the viewport.

2. **The page body never scrolls horizontally.** Wide content that genuinely
   cannot reflow — code blocks, wide tables, frame filmstrips, contact sheets —
   scrolls inside its own `overflow-x-auto` container.

3. **Side-by-side becomes stacked.** Two-pane layouts (form rail + output,
   problem + editor, list + detail) are `flex-col md:flex-row`. Where stacking
   would bury one pane under a long scroll, use tabs/segmented control on the
   phone instead.

4. **Rigid grids get a narrow step.** `grid-cols-4` → `grid-cols-2 md:grid-cols-4`.
   `grid-cols-5` → `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`. Prefer
   `grid-cols-[repeat(auto-fill,minmax(140px,1fr))]` when the item count varies.

5. **44px touch targets.** The `tap-target` utility applies `min-height`/
   `min-width: 44px` under `(pointer: coarse)` only, so desktop density is
   untouched. `<Button>` already has it. Bare `<button>` icon controls do not —
   add it.

   When the control's *size is the design* and growing it would wreck the look
   — a switch track, a chip's `×` — use **`tap-hit`** instead: it centres an
   invisible 44px pseudo-element on the control, costing no layout. Caveat: it
   does not work inside an `overflow-hidden` ancestor, which clips hit-testing
   as well as painting. A sub-44px control trapped in a clipped parent (e.g. an
   inline confirm button inside a small image tile) needs a different
   affordance on touch, not a class.

6. **Hover-only controls are unreachable on touch.** Tailwind v4 gates `hover:`
   behind `(hover: hover)`, so `opacity-0 group-hover:opacity-100` (the history
   grid delete buttons) is *permanently invisible* on a phone. Use the `coarse:`
   variant to reveal them: `opacity-0 coarse:opacity-100 group-hover:opacity-100`.
   The mirror variant is `fine:` (mouse only) — used for the ⌘K keycap hint,
   which is a lie on a touch device.

7. **Heights use `dvh`, never `vh`/`h-screen`.** iOS Safari's `vh` includes the
   collapsing URL bar, so `h-screen` puts your last row below the fold.

8. **Safe areas.** `pt-safe` / `pb-safe` / `px-safe` / `pb-safe-plus-4` wrap
   `env(safe-area-inset-*)`. Anything pinned to a screen edge (sticky headers,
   bottom bars, sheets, full-bleed toolbars) needs them or it lands under the
   notch/home indicator. They resolve to `0px` on desktop, so they are free.

9. **Inputs are 16px on touch.** Handled globally in `tokens.css` — Safari zooms
   the page when a focused field is smaller. Don't override `font-size` on an
   input to something smaller.

10. **Modals/dialogs/wizards: use `<Overlay>`.** It already becomes a
    bottom sheet with safe-area padding and internal scroll under `md`. Do not
    hand-roll a `fixed inset-0` dialog; if you find one, move it onto `Overlay`.
    Its `width` prop is desktop-only and ignored on a phone.

## Helpers

- `lib/useBreakpoint.ts` — `useIsMobile()` (<768), `useIsCompact()` (<1024),
  `useIsTouch()`, `useMediaQuery(q)`. Reach for these **only when the DOM must
  differ** (e.g. render tabs instead of two panes). If the change is purely
  visual, use a Tailwind class — a class costs no re-render.

## Checking your work

Chrome DevTools device toolbar, or the app itself at these widths:
**390×844** (iPhone 14 Pro), **768** (tablet), **1024**, **1440**. At each:
no horizontal scrollbar on `<body>`, no clipped text, no control under 44px,
every action reachable. Dark *and* light.
