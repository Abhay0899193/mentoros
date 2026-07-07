# Realistic face presets — generation spec (one-time asset pipeline)

Toolchain: mflux (MLX) — base t2i (FLUX.1-schnell 4-bit) + **FLUX.1-Kontext
instruction edits** for the mouth/blink variants, per
`~/mentoros-imagegen/USAGE.md`. (Kontext replaced FLUX Fill — no 4-bit mflux
Fill mirror exists; Kontext needs no masks and preserves identity. Edits are
composited back onto the base through a feathered ellipse via
`composite_variants.py` so frames stay pixel-aligned for the sprite stack.)
Content boundary (user-agreed): tasteful, non-explicit — normal attire only;
the attractiveness axis is styling/glam, never undress.

Output goes to `apps/desktop/src/renderer/orb/faces/art/<id>/` as WebP
(cwebp/sips convert from PNG, q≈82):

| file | source |
| --- | --- |
| portrait-base.webp | t2i, mouth closed, eyes open |
| portrait-m1.webp | Fill over mouth mask: "lips slightly parted, relaxed, caught mid soft speech" |
| portrait-m2.webp | Fill: "mouth open mid-speech saying 'ah', upper teeth just visible, natural" |
| portrait-m3.webp | Fill: "mouth open wide mid-word, expressive, upper teeth visible, natural" |
| portrait-blink.webp | Fill over eyes mask: "eyes closed, relaxed eyelids, natural lashes" |
| full.webp | t2i full-body, 832×1216 |

Shared style tail (both t2i prompts, keeps them native to the Nocturne dark
theme): "…, soft cinematic key light with a subtle cool rim light, dark
midnight-navy studio background with a faint violet glow, shallow depth of
field, 85mm portrait lens, natural skin texture, photorealistic, high detail"

Portrait framing: "head and shoulders portrait, facing the camera directly,
gentle closed-mouth smile, mouth closed, eyes open looking straight into the
camera" — 1024×1024. Full body: "full-body studio photograph, standing
relaxed facing the camera, whole figure in frame head to shoes" — 832×1216,
same character description + style tail.

## Presets (escalating glam, same tasteful register)

**lena** — seed 101 — "a beautiful woman in her late twenties with warm
honey-brown hair falling in loose natural waves, soft hazel eyes, light
freckles, minimal natural makeup, wearing a cream ribbed knit sweater;
girl-next-door warmth" · full-body outfit: "cream knit sweater, blue
straight-leg jeans, white sneakers"

**sienna** — seed 202 — "a strikingly attractive woman around thirty with
long dark chestnut waves swept to one side, deep brown eyes, polished
everyday makeup with soft matte lips, wearing a charcoal tailored blazer over
a black silk camisole; quietly magnetic, confident" · full-body: "charcoal
tailored blazer, black silk camisole, slim black trousers, pointed flats"

**kira** — seed 303 — "a glamorous, stunningly beautiful woman in her late
twenties with sleek espresso hair in an elegant low chignon with face-framing
strands, luminous grey-green eyes, defined evening makeup with winged liner
and deep rose lips, delicate drop earrings, wearing an elegant emerald satin
evening dress with tasteful neckline; editorial red-carpet polish" ·
full-body: "floor-length emerald satin evening gown with tasteful neckline,
delicate heels, small clutch"

## Kontext edit settings (replaces Fill)
steps 16, guidance 4.0, same seed family as the preset's base. Prompts are
action-first instructions ("Open her mouth wide as if speaking, saying 'ah',
upper teeth visible.") — do NOT append "keep everything exactly the same"
(probe-tested: with guidance 2.5 + keep-same clause the edit is silently
ignored; Kontext preserves identity by default). Composite each edit onto its
base with `composite_variants.py <base> <edit> <cx> <cy> <rx> <ry> <out>`
(mouth ellipse for m1–m3, eye band for blink; coords picked per base image).
Iterate seeds ±1..5 if a render has artifacts (warped teeth, drifted gaze) —
judge visually before compositing. Bases: iterate seeds on framing failures
too (mouth must be CLOSED on portrait-base; full-body must show head to
shoes — add "entire body visible from head to shoes, standing on a dark
studio floor" and swap the 85mm/shallow-DoF tail for "50mm lens, full-length
fashion photography" if crops persist).
