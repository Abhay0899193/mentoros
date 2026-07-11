# Avatar Animation System — Manual Test Checklist (2026-07-10)

Built without a runtime-verifier pass this session (per your directive) — this is the script
to shake it down by hand. Run `pnpm --filter @mentoros/desktop dev`. Nothing here needs the
GPU toolchain except the last section.

## 1 · Regression — existing presets must look unchanged
- [ ] Settings → Identity → Face → pick **Lena** (cameo). Voice screen: she blinks every few
      seconds; ask something — mouth follows her voice, **blinks still land mid-speech**.
- [ ] Switch View to **Full body** — full still renders, talk/blink overlays only apply in cameo.
- [ ] Pick **Nova** (stylized) — idle life (gaze, breathing), lip-sync, state expressions all
      read exactly as before.
- [ ] Identity gallery thumbnails animate on hover (stylized) / render stills (realistic).

## 2 · Avatar Studio — navigation & viewing
- [ ] Rail shows **Avatar Studio** (clapperboard, below the divider); ⌘K → "Go to Avatar Studio".
- [ ] Preset list groups: *Your presets* (or an empty-state line), *Built-in · Realistic*
      (Lena/Sienna/Kira + lock), *Built-in · Stylized* (Nova/Ivy/Rae + lock).
- [ ] Select **Lena**: view-only copy, clips **Blink** (Play works) + **Talk** ("hit Speak to
      audition"), trigger "Randomly every 2.4–5.2s → Blink" shown read-only.
- [ ] Preview controls: state row (idle/listening/thinking/speaking), **Speak** fakes an
      envelope — mouth animates; Cameo/Full toggle appears (Lena has a full still).
- [ ] Select **Nova**: gesture clips (Nod, Beam, Brow raise, Slow blink) — **Play steers the
      living SVG face** without killing its gaze/breath life.
- [ ] "Use on Voice screen" sets identity+face and the chip flips to "Active on Voice".

## 3 · Create from frames (the real fixtures: `img/1.png`, `img/2.png`, `img/3.PNG`)
- [ ] Studio → **Create from frames** → drop `img/1.png` in the slicer: grid auto-detects
      (expect 3×3); steppers + click-to-exclude work; "Add 9 frames".
- [ ] Assign: Base = a mouth-closed tile, Talk = 3 tiles closed→wide (order badges), Blink =
      the eyes-shut tile. Optional: add a full-body image.
- [ ] **Align step (new):** Mouth box (and Eyes box, since a blink is assigned) sits over the
      base — drag/resize to fit snugly (arrows move, Shift+arrows resize).
- [ ] **Align N frames** → aligned strip appears (Talk 1…N + Blink thumbnails). Each aligned
      frame should look like the BASE photo everywhere except the mouth (blink: except the
      eyes) — hair/shoulders/background must not shift between them.
- [ ] Preview step after aligning: **Speak** → lip-sync no longer "jumps" the whole picture
      between frames (compare with a Skip-align run of the same tiles — the point of the fix).
- [ ] Undo in the aligned strip reverts to raw frames; moving a box or toggling
      "Auto-correct frame drift" clears stale results (button re-runs).
- [ ] **Skip align** (footer) still works end-to-end — the step is optional.
- [ ] Preview step: name it; **Speak** → lip-sync from your tiles; blink fires on its own.
- [ ] Create → toast, preset appears under *Your presets* AND in Settings → Identity gallery.
- [ ] Use it on the Voice screen; ask something — real TTS drives the mouth.
- [ ] App restart: preset persists (config lives in core's SQLite; art in userData/faces/).

## 4 · Editing, clips & triggers (custom preset only)
- [ ] Rename inline in the header → save bar appears → Save → toast; name updates in the list.
- [ ] **Add clip**: e.g. "Wink" from one tile, track `eyes`, time driver, once — Play previews it.
- [ ] **Add trigger** · Message text: keywords `hello`, in *what I say* → Save. Open Chat with
      this preset active on Voice screen visible… actually: go to Voice, say/type "hello" in
      Chat — the clip fires on the mounted avatar (chat + voice both publish user messages).
- [ ] Trigger kinds spot-check: conversationEvent `speakingStarted`; shortcut `alt+shift+w`
      (fires anywhere in the app while the avatar is mounted); timer 10s; every 2 messages.
- [ ] Enable/disable Switch on a trigger row takes effect after Save.
- [ ] **Align in clip editor**: open a clip with ≥1 frame → "Align frames to the base…" link
      under the strip → preset base shows with ONE free-form "Region" box (seeded near the
      clip's track: mouth/eyes/center). Drag it over what moves, Align N frames → strip
      thumbnails become base-composited (identical outside the box), Undo restores originals.
- [ ] Align respects "Applies to": switch to `full` → the box now sits on the full-body still
      (link hidden if the preset has no full still). Adding/removing frames clears the Undo.
- [ ] Aligned clip Saves + plays without whole-frame jumping (check on Voice screen too).
- [ ] Delete a clip → its triggers disappear with it (draft), Save persists.
- [ ] Discard on the save bar reverts to the last saved doc.
- [ ] Delete the preset (header) → gone from list + gallery; if it was active, mentor falls
      back to the Orb/aura.

## 5 · Settings → Identity (slimmed)
- [ ] No delete ✕ on cards, no job card, no create-from-photos overlay — selection only.
- [ ] Dashed tile "New preset — in the Avatar Studio" navigates to the studio.

## 6 · Generate from photo (GPU path — optional, ~45–60 min)
- [ ] Studio → **Generate from photo** — same 3-step overlay as before (criteria, region
      picker, confirm). Job progress card sits at the top of the studio's preset list
      (cancel/dismiss there); Identity section shows a one-line pointer while it runs.
- [ ] Fast fake e2e instead: quit the app, relaunch dev with `MENTOROS_FACES_FAKE=1` — the
      Kontext step is stubbed with tinted frames, whole job takes seconds.

## 7 · Preset Generator — "Generate a preset" (text → full preset, GPU ~20–30 min)

Fast fake e2e first (recommended): relaunch dev with `MENTOROS_FACES_FAKE=1` — the
z-image-turbo step is stubbed with tinted frames, the whole batch takes seconds. Note the
Describe step's candidate reroll still uses the REAL Image Lab backend (fake mode only
stubs the faces job), so the reroll costs ~2 min per candidate either way.

- [ ] Studio → **Generate a preset** (primary button). Describe: type a character, Generate
      a candidate (~2 min, progress line + Cancel live), Reroll adds more; picking one
      shows its seed badge; Continue disabled until picked.
- [ ] Expressions: core 4 shown locked; 6 reactions default-on with editable prompts;
      Add expression → name/prompt/region-select rows; "Custom region…" says it'll be
      marked next step.
- [ ] Regions: auto-detect ON by default (empty state explains); flipping the switch shows
      draggable Mouth/Eyes/Face boxes over the picked candidate; custom-group expressions
      always show their own box.
- [ ] Generate: frame count + minutes estimate + seed shown; Generate → live progress card
      (step text, n-of-m frames, aurora bar); **Continue in background** closes the wizard
      and the studio sidebar job card takes over; Cancel keeps finished frames.
- [ ] On done: preset auto-selected in the studio, appears in Settings→Identity gallery,
      lip-sync + reactions play (Speak audition; think/smile fire in chat/voice).
- [ ] While a generate job runs: Image Lab generate is blocked with a clear 409 message
      (and vice versa: an Image Lab render blocks Generate/Reroll).
- [ ] Preset page (custom preset): **Generate expression** in the Clips header → dialog
      with catalog suggestions for reactions you skipped; submit renders ONE frame
      (~2 min GPU) and the clip appears after the job.
- [ ] A generated clip row shows a Regenerate button → same dialog prefilled; regenerating
      replaces the frame in place (fresh seed), clip id/triggers unchanged.
- [ ] Editor Save on a generated preset does NOT lose the ability to add expressions
      (edit any clip, Save, then Generate expression still offers catalog suggestions —
      the generation metadata survived the save).

**Known/accepted:** envelope mouth has ~3s startup latency after speak() (Kokoro buffering,
pre-existing); sheet tiles are square-cropped, so non-square cells lose their edges; grid
auto-detect needs a plain background (manual steppers always available); photo-preset
add-expression is gated on the z-image-turbo toolchain even though it edits via Kontext
(single shared probe — flag if annoying).
