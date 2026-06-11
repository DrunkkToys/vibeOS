#!/usr/bin/env bash
set -euo pipefail

FFMPEG="/Users/drunkktoys/homebrew/bin/ffmpeg"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES_DIR="$SCRIPT_DIR/output/frames"
OUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUT_DIR"

add_scene() {
  local concat_file="$1" frame="$2" duration="$3"
  echo "file '${FRAMES_DIR}/${frame}.png'" >> "$concat_file"
  echo "duration $duration" >> "$concat_file"
}

# ─── Desktop version (16:9) ────────────────────
echo "📹 Building desktop commercial (1920x1080)..."
DESKTOP_OUT="$OUT_DIR/vibeos-desktop-commercial.mp4"
CONCAT="$OUT_DIR/desktop_concat.txt"
rm -f "$CONCAT"

add_scene "$CONCAT" "desktop_s0_intro"    3
add_scene "$CONCAT" "desktop_s1_problem"   5
add_scene "$CONCAT" "desktop_s2_dashboard" 6
add_scene "$CONCAT" "desktop_s3_delegate"  7
add_scene "$CONCAT" "desktop_s4_modes"     8
add_scene "$CONCAT" "desktop_s5_stress"    6
add_scene "$CONCAT" "desktop_s6_flowtdd"   6
add_scene "$CONCAT" "desktop_s7_footer"    5
add_scene "$CONCAT" "desktop_s8_cta"       4
echo "file '${FRAMES_DIR}/desktop_s8_cta.png'" >> "$CONCAT"

"$FFMPEG" -y -f concat -safe 0 -i "$CONCAT" \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -movflags +faststart \
  "$DESKTOP_OUT"

echo "✅ Desktop: $DESKTOP_OUT ($(du -h "$DESKTOP_OUT" | cut -f1))"

# ─── Social version (9:16) ─────────────────────
echo "📱 Building social commercial (1080x1920)..."
SOCIAL_OUT="$OUT_DIR/vibeos-social-commercial.mp4"
SCONCAT="$OUT_DIR/social_concat.txt"
rm -f "$SCONCAT"

add_scene "$SCONCAT" "social_ss0" 2
add_scene "$SCONCAT" "social_ss1" 3
add_scene "$SCONCAT" "social_ss2" 4
add_scene "$SCONCAT" "social_ss3" 4
add_scene "$SCONCAT" "social_ss4" 3
add_scene "$SCONCAT" "social_ss5" 3
add_scene "$SCONCAT" "social_ss6" 4
echo "file '${FRAMES_DIR}/social_ss6.png'" >> "$SCONCAT"

"$FFMPEG" -y -f concat -safe 0 -i "$SCONCAT" \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -movflags +faststart \
  "$SOCIAL_OUT"

echo "✅ Social:  $SOCIAL_OUT ($(du -h "$SOCIAL_OUT" | cut -f1))"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  ✅ vibeOS commercials ready              ║"
echo "║                                           ║"
echo "║  Desktop: $DESKTOP_OUT"
echo "║  Social:  $SOCIAL_OUT"
echo "║                                           ║"
echo "║  Add music:                               ║"
echo "║  ffmpeg -i in.mp4 -i song.mp3             ║"
echo "║    -filter_complex volume=0.25 -c:v copy  ║"
echo "╚════════════════════════════════════════════╝"
