#!/usr/bin/env bash
set -euo pipefail

FFMPEG="/Users/drunkktoys/homebrew/bin/ffmpeg"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES_DIR="$SCRIPT_DIR/output/frames"
OUT_DIR="$SCRIPT_DIR/output"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

frame_to_clip() {
  local frame="$1" out="$2" dur="$3" zoom_end="${4:-1.02}"
  local w=$(ffprobe -v error -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$frame")
  local h=$(ffprobe -v error -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$frame")
  local total_frames=$(echo "$dur * 30" | bc | cut -d. -f1)
  "$FFMPEG" -y -loop 1 -i "$frame" \
    -vf "zoompan=z='min(zoom+0.0006,$zoom_end)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30" \
    -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
    -frames:v "$total_frames" "$out"
}

zoom_in_clip() {
  local frame="$1" out="$2" dur="$3"
  frame_to_clip "$frame" "$out" "$dur" "1.04"
}

crossfade() {
  local a="$1" b="$2" out="$3" fade_dur="${4:-0.5}"
  local a_dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$a")
  a_dur=$(echo "$a_dur - $fade_dur" | bc -l)
  "$FFMPEG" -y -i "$a" -i "$b" \
    -filter_complex "xfade=transition=fade:duration=${fade_dur}:offset=${a_dur}" \
    -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$out"
}

gen_bgm() {
  local out="$1" dur="$2"
  "$FFMPEG" -y -f lavfi -i "sine=frequency=110:duration=$dur,volume=0.06" \
    -f lavfi -i "sine=frequency=165:duration=$dur,volume=0.03" \
    -f lavfi -i "sine=frequency=55:duration=$dur,volume=0.04" \
    -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest,afade=in:0:1.5,afade=out:st=$((dur-2)):d=2" \
    -c:a libmp3lame -b:a 128k "$out"
}

echo "  Building desktop commercial with terminal-style frames..."

# Desktop scenes: name, duration, zoom_end
# Format: "name|duration|zoom_type"
DESKTOP_SCENES=(
  "s1_launch|3.5|normal"
  "s2_dashboard|6|normal"
  "s3_block|6|normal"
  "s3b_zoom_savings|4|zoom"
  "s4_modes|6|normal"
  "s5_cache_speed|6|normal"
  "s5b_zoom_cache|4|zoom"
  "s6_stress|5|normal"
  "s7_footer|6|normal"
  "s8_cta|5|normal"
)

prev=""
idx=0
for entry in "${DESKTOP_SCENES[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  dur="${rest%%|*}"
  ztype="${rest##*|}"
  frame="${FRAMES_DIR}/${name}.png"
  clip="$TMP/d_${name}.mp4"
  
  if [ "$ztype" = "zoom" ]; then
    zoom_in_clip "$frame" "$clip" "$dur"
  else
    frame_to_clip "$frame" "$clip" "$dur"
  fi
  
  if [ -z "$prev" ]; then
    prev="$clip"
  else
    merged="$TMP/merged_${idx}.mp4"
    crossfade "$prev" "$clip" "$merged" 0.5
    prev="$merged"
  fi
  idx=$((idx+1))
done

DESKTOP_OUT="$OUT_DIR/vibeos-terminal-desktop.mp4"
DESK_DUR=55
BGM="$TMP/bgm_desktop.mp3"
gen_bgm "$BGM" "$DESK_DUR"
"$FFMPEG" -y -i "$prev" -i "$BGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$DESKTOP_OUT"
echo "  Desktop: $DESKTOP_OUT ($(du -h "$DESKTOP_OUT" | cut -f1))"

# ─── Social version ─────────────────────────
echo "  Building social commercial..."

SOCIAL_SCENES=(
  "soc_s1_main|5|normal"
  "soc_s2_zoom|4|zoom"
  "soc_s3_cta|5|normal"
)

sprev=""
sidx=0
for entry in "${SOCIAL_SCENES[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  dur="${rest%%|*}"
  ztype="${rest##*|}"
  frame="${FRAMES_DIR}/${name}.png"
  clip="$TMP/s_${name}.mp4"
  
  if [ "$ztype" = "zoom" ]; then
    zoom_in_clip "$frame" "$clip" "$dur"
  else
    frame_to_clip "$frame" "$clip" "$dur"
  fi
  
  if [ -z "$sprev" ]; then
    sprev="$clip"
  else
    smerged="$TMP/smerged_${sidx}.mp4"
    crossfade "$sprev" "$clip" "$smerged" 0.4
    sprev="$smerged"
  fi
  sidx=$((sidx+1))
done

SOCIAL_OUT="$OUT_DIR/vibeos-terminal-social.mp4"
SOC_DUR=14
SBGM="$TMP/bgm_social.mp3"
gen_bgm "$SBGM" "$SOC_DUR"
"$FFMPEG" -y -i "$sprev" -i "$SBGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$SOCIAL_OUT"
echo "  Social:  $SOCIAL_OUT ($(du -h "$SOCIAL_OUT" | cut -f1))"

echo ""
echo "  Terminal-style commercials ready."
echo "  Desktop: $DESKTOP_OUT"
echo "  Social:  $SOCIAL_OUT"
