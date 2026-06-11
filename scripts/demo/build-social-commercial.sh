#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────
#  vibeOS Social Commercial Build (TikTok / Reels / Shorts)
#  Input:  screen recording (any format)
#  Output: 1080x1920 30fps MP4 — vertical, punchy, ~45s
#  Usage:  ./build-social-commercial.sh recording.mov [bgm.mp3]
# ─────────────────────────────────────────────

INPUT="${1:?Usage: $0 <recording.mov> [background-music.mp3]}"
BGM="${2:-}"
OUTPUT="vibeos-social-commercial.mp4"

require() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Missing: $1 — brew install $1"; exit 1; }; }
require ffmpeg

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
echo "📱 Input: ${DURATION}s | Output: 1080x1920 vertical"

# ─── Helper: text overlay clip ────────────────
make_overlay() {
  local text="$1" color="${2:-#00ff88}" size="${3:-42}" y_pos="${4:-(h-text_h)/2-200}"
  ffmpeg -y -f lavfi -i "color=c=black@0:s=1080x100:d=4,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y_pos}:text='${text}'" \
    -c:v libx264 -preset ultrafast -crf 0 -pix_fmt yuva420p \
    "$TMP_DIR/overlay_$(echo "$text" | md5).mp4" -v quiet 2>/dev/null || true
}

# ─── Step 1: Vertical crop + speed ramp ──────
# Crop center portion for 9:16, speed up sections
FILTER="
  [0:v]
  crop=min(iw\,ih*9/16):min(ih\,iw*16/9):(iw-ow)/2:(ih-oh)/2,
  scale=1080:1920:force_original_aspect_ratio=increase,
  crop=1080:1920,
  fade=in:0:15,
  fade=out:st=$((DURATION-1)):d=15
  [v]
"

ffmpeg -y -i "$INPUT" \
  -filter_complex "$FILTER" \
  -map "[v]" -an \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  "$TMP_DIR/cropped.mp4" -v quiet

# ─── Step 2: Split into clips by scene markers ──
# We use scene detection to find cuts, then extract
ffmpeg -y -i "$TMP_DIR/cropped.mp4" \
  -vf "select='gt(scene\,0.4)',showinfo" \
  -vsync vfr -f null /dev/null 2>&1 | \
  grep -oP 'pts_time:\K[\d.]+' > "$TMP_DIR/scenes.txt" || true

# ─── Step 3: Create chapter cards between scenes ──
# Chapter 1: "vibeOS" brand intro
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1080x1920:d=2,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-80:text='vibeOS',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#aaaaee:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+10:text='Save money while you code',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#666688:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2+70:text='OpenCode plugin'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/chapter_0.mp4" -v quiet

# Chapter 2: "trinity status" feature
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1080x1920:d=1.5,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2-30:text='trinity status',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+30:text='Full savings dashboard'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/chapter_1.mp4" -v quiet

# Chapter 3: "delegation enforcement"
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1080x1920:d=1.5,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#ff4444:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2-30:text='Delegation Enforcement',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#ffaa44:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+30:text='Blocks expensive brain-tier writes'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/chapter_2.mp4" -v quiet

# Chapter 4: "mode switching"
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1080x1920:d=1.5,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2-30:text='trinity mode',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+30:text='Quality / Speed / Budget'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/chapter_3.mp4" -v quiet

# Chapter 5: CTA
ffmpeg -y -f lavfi -i "color=c=#0a0a1a:s=1080x1920:d=3,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2-60:text='npm install vibeoscore',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#00ff88:fontsize=30:x=(w-text_w)/2:y=(h-text_h)/2+20:text='Free. Open Source. Save real $$$.',drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:fontcolor=#8888aa:fontsize=22:x=(w-text_w)/2:y=(h-text_h)/2+80:text='github.com/anomalyco/vibeOS'" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/chapter_5.mp4" -v quiet

# ─── Step 4: Assemble timeline ────────────────
echo "file '$TMP_DIR/chapter_0.mp4'"  > "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/cropped.mp4'"    >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/chapter_1.mp4'"  >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/cropped.mp4'"    >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/chapter_2.mp4'"  >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/cropped.mp4'"    >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/chapter_3.mp4'"  >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/cropped.mp4'"    >> "$TMP_DIR/timeline.txt"
echo "file '$TMP_DIR/chapter_5.mp4'"  >> "$TMP_DIR/timeline.txt"

ffmpeg -y -f concat -safe 0 -i "$TMP_DIR/timeline.txt" \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -movflags +faststart \
  "$TMP_DIR/assembled.mp4" -v quiet

# ─── Step 5: Add music (optional) ──────────────
ASSEMBLED_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMP_DIR/assembled.mp4")
if [[ -n "$BGM" && -f "$BGM" ]]; then
  ffmpeg -y -i "$TMP_DIR/assembled.mp4" -i "$BGM" \
    -filter_complex "[1:a]atrim=0:${ASSEMBLED_DUR},afade=in:0:1,afade=out:st=$(( ${ASSEMBLED_DUR%.*} - 2 )):d=2,volume=0.3[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest \
    -movflags +faststart \
    "$OUTPUT" -v quiet
else
  cp "$TMP_DIR/assembled.mp4" "$OUTPUT"
fi

echo "✅ Done → $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
