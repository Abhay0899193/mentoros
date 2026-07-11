#!/bin/bash
# Kiki preset frame generation — z-image-turbo t2i, SAME seed, shared character
# clause + per-frame trailing expression clause. Skip-if-exists so re-runs resume.
# Usage: gen_kiki.sh [filter]   (filter = frame name substring, e.g. "m2")
set -u
OUT=$HOME/mentoros-imagegen/out/kiki
BIN=$HOME/.local/bin/mflux-generate-z-image-turbo
export HF_HOME=$HOME/mentoros-imagegen/hf-cache
export HF_HUB_DISABLE_XET=1
export HF_HUB_DOWNLOAD_TIMEOUT=30
MODEL_ARGS=(--model filipstrand/Z-Image-Turbo-mflux-4bit --base-model z-image-turbo)
SEED=777
CHAR="Studio portrait photograph of Kiki, a beautiful young Indian woman in her mid-twenties, warm brown eyes, long dark wavy hair falling over her shoulders, small gold stud earrings, wearing an elegant emerald green blouse, soft diffused studio lighting, plain dark charcoal background, facing the camera directly, head and shoulders framing, photorealistic, sharp focus."

FILTER="${1:-}"

gen() { # name expr_clause [w] [h]
  local name="$1" expr="$2" w="${3:-1024}" h="${4:-1024}"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && return 0
  [ -f "$OUT/$name.png" ] && { echo "== $name exists, skip"; return 0; }
  echo "== generating $name ($(date +%H:%M:%S))"
  "$BIN" "${MODEL_ARGS[@]}" --prompt "$CHAR $expr" \
    --width "$w" --height "$h" --steps 8 --seed $SEED \
    --output "$OUT/$name.png" || echo "!! $name FAILED"
}

gen base  "Calm friendly neutral expression, lips gently closed, eyes open looking at the camera."
gen blink "Calm neutral expression, eyes fully closed with relaxed eyelids, lips gently closed."
gen m1    "Calm expression, lips relaxed and slightly parted leaving a small soft gap, no teeth visible, eyes open looking at the camera."
gen m2    "Speaking mid-word with her mouth half open as if saying ah, upper teeth just visible, eyes open looking at the camera."
gen m3    "Speaking expressively with her mouth open wide mid-word, upper teeth visible, eyes open looking at the camera."
gen think "Thoughtful pondering expression, eyes glancing up and to one side, lips gently closed, one eyebrow slightly raised."
gen smile "Warm broad smile with teeth showing, joyful bright eyes looking at the camera."
gen annoyed "Annoyed irritated expression, a slight frown, one eyebrow raised, lips pressed flat together, skeptical eyes looking at the camera."
gen angry "Angry stern expression, furrowed brows, intense glare directly at the camera, lips pressed tightly together."
gen surprised "Surprised astonished expression, eyebrows raised high, eyes wide open, lips softly parted."
gen laugh "Laughing heartily, big open smile showing teeth, eyes crinkled with joy."
# full-body still (separate composition — no lip-sync, direct 2:3 crop later)
gen full "Full length studio photograph, standing relaxed with head-to-shoes framing visible from hair to shoes, wearing an elegant emerald green blouse, dark tailored trousers and heels, photorealistic." 832 1248
echo "== all done ($(date +%H:%M:%S))"
