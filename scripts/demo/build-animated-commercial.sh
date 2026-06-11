#!/usr/bin/env bash
set -euo pipefail

FFMPEG="/Users/drunkktoys/homebrew/bin/ffmpeg"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES_DIR="$SCRIPT_DIR/output/frames"
OUT_DIR="$SCRIPT_DIR/output"
TIMING_FILE="$FRAMES_DIR/anim_timing.txt"

echo "  Building animated desktop commercial from $TIMING_FILE..."

DESKTOP_OUT="$OUT_DIR/vibeos-animated-desktop.mp4"

"$FFMPEG" -y -f concat -safe 0 -i "$TIMING_FILE" \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -movflags +faststart \
  "$DESKTOP_OUT"

DESK_S=$(( $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$DESKTOP_OUT" | cut -d. -f1) ))

# Add ambient BGM
BGM="$OUT_DIR/animated_bgm.mp3"
"$FFMPEG" -y -f lavfi -i "sine=frequency=110:duration=$DESK_S,volume=0.05" \
  -f lavfi -i "sine=frequency=165:duration=$DESK_S,volume=0.025" \
  -f lavfi -i "sine=frequency=55:duration=$DESK_S,volume=0.035" \
  -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest,afade=in:0:1,afade=out:st=$((DESK_S-2)):d=2" \
  -c:a libmp3lame -b:a 128k "$BGM"

FINAL_DESKTOP="$OUT_DIR/vibeos-desktop-final.mp4"
"$FFMPEG" -y -i "$DESKTOP_OUT" -i "$BGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$FINAL_DESKTOP"
rm -f "$DESKTOP_OUT" "$BGM"

echo "  Desktop: $FINAL_DESKTOP ($(du -h "$FINAL_DESKTOP" | cut -f1) / ${DESK_S}s)"

# ─── Social version (vertical, quick cuts) ──────
echo "  Building animated social commercial..."

# Fewer frames, bigger text, vertical layout
python3 -c "
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1920
BG = (14, 14, 18)
FG = (220, 220, 220)
GRN = (0, 221, 102)
CYN = (0, 204, 255)
YLW = (255, 170, 0)
RED = (255, 68, 68)
DIM = (102, 102, 136)
WHT = (255, 255, 255)
ORG = (255, 136, 0)
BLK_BG = (45, 12, 12)

FONT = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 22)
FONT_BIG = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 34)

out = '$FRAMES_DIR'
timing = os.path.join(out, 'social_timing.txt')
open(timing, 'w').close()

def f(lines, dur, name):
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)
    y = 60
    for line in lines:
        if not line:
            y += 30; continue
        color = FG; text = line
        if line.startswith('>'): color, text = GRN, line[1:]
        elif line.startswith('!'): color, text = RED, line[1:]
        elif line.startswith('='): color, text = CYN, line[1:]
        elif line.startswith('+'): color, text = GRN, line[1:]
        elif line.startswith('-'): color, text = DIM, line[1:]
        elif line.startswith('*'): color, text = YLW, line[1:]
        elif line.startswith('#'): color, text = ORG, line[1:]
        elif line.startswith('@'): color, text = WHT, line[1:]
        font = FONT_BIG if line.startswith('@') else FONT
        draw.text((30, y), text, fill=color, font=font)
        y += 32
    path = os.path.join(out, name + '.png')
    img.save(path)
    with open(timing, 'a') as tf:
        tf.write(f\"file '{path}'\n\")
        tf.write(f'duration {dur}\n')

# Social scenes — fast, punchy
f(['@vibeOS', '', '+Save money', '+while you code.'], 1.5, 'social_a')
f(['@vibeOS', '', '+Save money', '+while you code.', '', '-OpenCode plugin'], 1.5, 'social_b')

f(['>trinity status', '', '+$142.30 total saved', '+$112.90 delegation', '+$25.52 cache', '*Guards: enforce ON'], 3, 'social_c1')

f(['!BRAIN WRITE BLOCKED', '', '*$0.034 per edit saved', '*4,213 edits delegated', '*95% cheaper routing'], 3, 'social_c2')

f(['=quality · speed · budget', '', '+One word changes', '+your entire profile', '', '=Insane speed.'], 3, 'social_c3')

f(['@npm install vibeoscore', '', '-github.com/anomalyco/vibeOS', '', '#Free. Open Source.'], 3, 'social_c4')

with open(timing, 'a') as tf:
    tf.write(f\"file '{os.path.join(out, 'social_c4.png')}'\n\")
print('Social frames generated')
"

SOCIAL_TIMING="$FRAMES_DIR/social_timing.txt"
SOCIAL_TMP="$OUT_DIR/social_tmp.mp4"
"$FFMPEG" -y -f concat -safe 0 -i "$SOCIAL_TIMING" \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -movflags +faststart "$SOCIAL_TMP"

SOC_S=$(( $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$SOCIAL_TMP" | cut -d. -f1) ))

SBGM="$OUT_DIR/social_bgm.mp3"
"$FFMPEG" -y -f lavfi -i "sine=frequency=110:duration=$SOC_S,volume=0.05" \
  -f lavfi -i "sine=frequency=165:duration=$SOC_S,volume=0.025" \
  -f lavfi -i "sine=frequency=55:duration=$SOC_S,volume=0.035" \
  -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest,afade=in:0:0.5,afade=out:st=$((SOC_S-1)):d=1" \
  -c:a libmp3lame -b:a 128k "$SBGM"

FINAL_SOCIAL="$OUT_DIR/vibeos-social-final.mp4"
"$FFMPEG" -y -i "$SOCIAL_TMP" -i "$SBGM" \
  -c:v copy -c:a aac -b:a 128k -shortest \
  -movflags +faststart "$FINAL_SOCIAL"
rm -f "$SOCIAL_TMP" "$SBGM"

echo "  Social:  $FINAL_SOCIAL ($(du -h "$FINAL_SOCIAL" | cut -f1) / ${SOC_S}s)"

echo ""
echo "  Animated commercials ready:"
echo "  Desktop: $FINAL_DESKTOP"
echo "  Social:  $FINAL_SOCIAL"
