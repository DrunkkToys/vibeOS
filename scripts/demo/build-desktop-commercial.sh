#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────
#  vibeOS Desktop Commercial Build
#  Input:  screen recording (any format)
#  Output: 1920x1080 30fps MP4
#  Usage:  ./build-desktop-commercial.sh recording.mov [bgm.mp3]
# ─────────────────────────────────────────────

INPUT="${1:?Usage: $0 <recording.mov> [background-music.mp3]}"
BGM="${2:-}"
OUTPUT="vibeos-desktop-commercial.mp4"

require() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Missing: $1 — brew install $1"; exit 1; }; }
require ffmpeg

# Clean up temp files on exit
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
DURATION=${DURATION%.*}
echo "📹 Input duration: ${DURATION}s | Output: $OUTPUT"

# ─── Generate title card (3s) ────────────────
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1920x1080:d=3,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-60:text='vibeOS',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2+40:text='The Smart Savings Layer for OpenCode'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/title.mp4" -v quiet

# ─── Generate call-to-action card (3s) ────────
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1920x1080:d=3,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-40:text='npm install vibeoscore',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#8888aa:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+30:text='github.com/anomalyco/vibeOS'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/cta.mp4" -v quiet

# ─── Generate overlay snippets ────────────────
# Feature callout overlays (transparent PNGs on dark bg)
for i in 1 2 3 4; do
  TEXT=""
  case $i in
    1) TEXT="trinity status — full savings dashboard" ;;
    2) TEXT="Auto-delegation — brain blocked, cheap worker saves \$" ;;
    3) TEXT="trinity mode — quality / speed / budget at will" ;;
    4) TEXT="Stress gauge — auto-protects when you're frustrated" ;;
  esac
  ffmpeg -y -f lavfi -i "color=c=black@0:s=1920x60,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=28:x=20:y=(h-text_h)/2:text='${TEXT}'" \
    -c:v libx264 -preset ultrafast -crf 0 -pix_fmt yuva420p \
    "$TMP_DIR/overlay_$i.mp4" -v quiet 2>/dev/null || true
done

# ─── Process main recording ───────────────────
# Normalize to 1920x1080, add fade-in/out
ffmpeg -y -i "$INPUT" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fade=in:0:30,fade=out:st=$((DURATION-1)):d=30" \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  -an \
  "$TMP_DIR/main.mp4" -v quiet

# ─── Concatenate: title → main → cta ──────────
echo "file '$TMP_DIR/title.mp4'"  > "$TMP_DIR/concat.txt"
echo "file '$TMP_DIR/main.mp4'"  >> "$TMP_DIR/concat.txt"
echo "file '$TMP_DIR/cta.mp4'"   >> "$TMP_DIR/concat.txt"

ffmpeg -y -f concat -safe 0 -i "$TMP_DIR/concat.txt" \
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -movflags +faststart \
  "$TMP_DIR/combined.mp4" -v quiet

# ─── Add background music (if provided) ────────
if [[ -n "$BGM" && -f "$BGM" ]]; then
  COMBINED_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMP_DIR/combined.mp4")
  ffmpeg -y -i "$TMP_DIR/combined.mp4" -i "$BGM" \
    -filter_complex "[1:a]atrim=0:${COMBINED_DUR},afade=out:st=$(( ${COMBINED_DUR%.*} - 2 )):d=2,volume=0.25[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest \
    -movflags +faststart \
    "$OUTPUT" -v quiet
else
  cp "$TMP_DIR/combined.mp4" "$OUTPUT"
fi

echo "✅ Done → $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
