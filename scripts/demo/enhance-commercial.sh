#!/usr/bin/env bash
set -euo pipefail

FFMPEG="/Users/drunkktoys/homebrew/bin/ffmpeg"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES_DIR="$SCRIPT_DIR/output/frames"
OUT_DIR="$SCRIPT_DIR/output"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

frame_to_clip() {
  local frame="$1" out="$2" dur="$3"
  local w=$(ffprobe -v error -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$frame")
  local h=$(ffprobe -v error -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$frame")
  "$FFMPEG" -y -loop 1 -i "$frame" \
    -vf "zoompan=z='min(zoom+0.0005,1.02)':d=${dur}*30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30,format=yuv420p" \
    -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
    -t "$dur" "$out"
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
  "$FFMPEG" -y -f lavfi -i "sine=frequency=110:duration=$dur,volume=0.08" \
    -f lavfi -i "sine=frequency=220:duration=$dur,volume=0.04" \
    -f lavfi -i "sine=frequency=55:duration=$dur,volume=0.06" \
    -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest,afade=in:0:2,afade=out:st=$((dur-2)):d=2" \
    -c:a libmp3lame -b:a 128k "$out"
}

echo "Enhancing desktop commercial..."

DDUR_s0_intro=3 DDUR_s1_problem=5 DDUR_s2_dashboard=6 DDUR_s3_delegate=7
DDUR_s4_modes=8 DDUR_s5_stress=6 DDUR_s6_flowtdd=6 DDUR_s7_footer=5 DDUR_s8_cta=4

SCENES="s0_intro s1_problem s2_dashboard s3_delegate s4_modes s5_stress s6_flowtdd s7_footer s8_cta"
prev=""
for scene in $SCENES; do
  frame="${FRAMES_DIR}/desktop_${scene}.png"
  clip="$TMP/desktop_${scene}.mp4"
  eval "dur=\$DDUR_${scene}"
  frame_to_clip "$frame" "$clip" "$dur"
  if [ -z "$prev" ]; then
    prev="$clip"
  else
    merged="$TMP/merged_${scene}.mp4"
    crossfade "$prev" "$clip" "$merged" 0.5
    prev="$merged"
  fi
done

DESKTOP_OUT="$OUT_DIR/vibeos-desktop-enhanced.mp4"
BGM="$TMP/bgm.mp3"
gen_bgm "$BGM" 54
"$FFMPEG" -y -i "$prev" -i "$BGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$DESKTOP_OUT"
echo "Desktop enhanced: $DESKTOP_OUT ($(du -h "$DESKTOP_OUT" | cut -f1))"

echo "Enhancing social commercial..."

SDUR_ss0=2 SDUR_ss1=3 SDUR_ss2=4 SDUR_ss3=4 SDUR_ss4=3 SDUR_ss5=3 SDUR_ss6=4
SSCENES="ss0 ss1 ss2 ss3 ss4 ss5 ss6"

sprev=""
for scene in $SSCENES; do
  frame="${FRAMES_DIR}/social_${scene}.png"
  clip="$TMP/social_${scene}.mp4"
  eval "dur=\$SDUR_${scene}"
  frame_to_clip "$frame" "$clip" "$dur"
  if [ -z "$sprev" ]; then
    sprev="$clip"
  else
    smerged="$TMP/smerged_${scene}.mp4"
    crossfade "$sprev" "$clip" "$smerged" 0.35
    sprev="$smerged"
  fi
done

SOCIAL_OUT="$OUT_DIR/vibeos-social-enhanced.mp4"
SBGM="$TMP/sbgm.mp3"
gen_bgm "$SBGM" 27
"$FFMPEG" -y -i "$sprev" -i "$SBGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$SOCIAL_OUT"
echo "Social enhanced: $SOCIAL_OUT ($(du -h "$SOCIAL_OUT" | cut -f1))"
echo ""
echo "Enhanced versions: Ken Burns zoom + crossfades + ambient bgm."
