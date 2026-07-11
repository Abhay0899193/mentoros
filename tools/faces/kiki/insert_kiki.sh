#!/bin/bash
# Insert the Kiki preset into the MentorOS app DB + copy art to userData.
# Usage: insert_kiki.sh "#rrggbb"   (accent from finalize_kiki.py output)
set -euo pipefail
ACCENT="${1:?accent hex required}"
ART_SRC=$HOME/mentoros-imagegen/out/kiki/art
DATA_DIR="$HOME/Library/Application Support/@mentoros/desktop/data"
DB="$DATA_DIR/mentoros.db"
DEST="$DATA_DIR/faces/face-kiki"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

mkdir -p "$DEST"
cp "$ART_SRC"/*.webp "$DEST/"
HAS_FULL=0; [ -f "$DEST/full.webp" ] && HAS_FULL=1

CONFIG=$(python3 - "$ACCENT" "$NOW" "$HAS_FULL" <<'PY'
import json, sys
accent, now, has_full = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
def sprite(id, name, category, track, frames, priority, **kw):
    c = {"id": id, "name": name, "category": category, "appliesTo": "portrait",
         "renderKind": "sprite", "track": track, "driver": kw.pop("driver", "time"),
         "loopMode": kw.pop("loopMode", "once"), "priority": priority, "frames": frames}
    c.update(kw)
    return c
animations = [
    sprite("blink", "Blink", "idle", "eyes", ["portrait-blink.webp"], 10, durationMs=130),
    sprite("talk", "Talk", "idle", "mouth",
           ["portrait-m1.webp", "portrait-m2.webp", "portrait-m3.webp"], 20,
           driver="envelope", loopMode="loop"),
    sprite("think", "Think", "reaction", "main", ["anim-think-0.webp"], 30, durationMs=2200),
    sprite("smile", "Smile", "reaction", "main", ["anim-smile-0.webp"], 30, durationMs=2000),
    sprite("annoyed", "Annoyed", "reaction", "main", ["anim-annoyed-0.webp"], 30, durationMs=2000),
    sprite("angry", "Angry", "reaction", "main", ["anim-angry-0.webp"], 30, durationMs=2000),
    sprite("surprised", "Surprised", "reaction", "main", ["anim-surprised-0.webp"], 30, durationMs=1600),
    sprite("laugh", "Laugh", "reaction", "main", ["anim-laugh-0.webp"], 30, durationMs=2200),
]
triggers = [
    {"id": "blink-auto", "animationId": "blink", "kind": "randomInterval",
     "minMs": 2400, "maxMs": 5200, "enabled": True},
    {"id": "think-on-thinking", "animationId": "think", "kind": "conversationEvent",
     "event": "thinking", "enabled": True},
    {"id": "smile-greet", "animationId": "smile", "kind": "conversationEvent",
     "event": "conversationStarted", "enabled": True},
    {"id": "smile-praise", "animationId": "smile", "kind": "textMatch", "mode": "keywords",
     "target": "assistant", "patterns": ["great", "excellent", "well done", "perfect"],
     "enabled": True},
    {"id": "laugh-on-humor", "animationId": "laugh", "kind": "textMatch", "mode": "keywords",
     "target": "assistant", "patterns": ["haha", "funny", "hilarious"], "enabled": True},
    {"id": "annoyed-manual", "animationId": "annoyed", "kind": "manual", "enabled": True},
    {"id": "angry-manual", "animationId": "angry", "kind": "manual", "enabled": True},
    {"id": "surprised-manual", "animationId": "surprised", "kind": "manual", "enabled": True},
]
config = {"schemaVersion": 1, "presetId": "face-kiki", "name": "Kiki", "accent": accent,
          "baseFrame": "portrait-base.webp", "animations": animations, "triggers": triggers,
          "createdAt": now, "updatedAt": now}
if has_full:
    config["fullBase"] = "full.webp"
print(json.dumps(config))
PY
)

sqlite3 "$DB" <<SQL
INSERT INTO face_presets (id, name, accent, has_full, created_at, config_json)
VALUES ('face-kiki', 'Kiki', '$ACCENT', $HAS_FULL, '$NOW', '$(printf %s "$CONFIG" | sed "s/'/''/g")')
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, accent=excluded.accent, has_full=excluded.has_full,
  config_json=excluded.config_json;
SQL

echo "inserted face-kiki (accent $ACCENT, has_full=$HAS_FULL)"
sqlite3 "$DB" "SELECT id, name, accent, has_full, length(config_json) FROM face_presets WHERE id='face-kiki';"
ls -la "$DEST"
