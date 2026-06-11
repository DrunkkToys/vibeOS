#!/usr/bin/env bash
set -euo pipefail

FFMPEG="/Users/drunkktoys/homebrew/bin/ffmpeg"
OUT_DIR="${OUT_DIR:-$(dirname "$0")/output}"
mkdir -p "$OUT_DIR"
FONT="/System/Library/Fonts/Menlo.ttc"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

W=1920 H=1080
BG="#0a0a10" FG="#e0e0e0" GREEN="#00dd66" CYAN="#00ccff"
YELLOW="#ffaa00" RED="#ff4444" DIM="#666688" HEADER="#ffffff"
PROMPT_COLOR="#00dd66"

scene() {
  local name="$1" duration="$2" lines="$3"
  local out="$TMP/${name}.mp4"
  local vf="color=c=${BG}:s=${W}x${H}:d=${duration},"
  local y=80 idx=0
  local old_ifs="$IFS"
  IFS=$'\n'
  for line in $lines; do
    idx=$((idx+1))
    local ypos=$((y + (idx-1)*38))
    local color="$FG" size=28

    case "$line" in
      "PROMPT:"*) color="$PROMPT_COLOR" size=24 line="${line#PROMPT:}" ;;
      "HEADER:"*) color="$HEADER" size=34 line="${line#HEADER:}" ;;
      "GREEN:"*)  color="$GREEN"  size=28 line="${line#GREEN:}" ;;
      "CYAN:"*)   color="$CYAN"   size=28 line="${line#CYAN:}" ;;
      "YELLOW:"*) color="$YELLOW" size=28 line="${line#YELLOW:}" ;;
      "RED:"*)    color="$RED"    size=28 line="${line#RED:}" ;;
      "DIM:"*)    color="$DIM"    size=22 line="${line#DIM:}" ;;
      "BIG:"*)    color="$HEADER" size=48 line="${line#BIG:}" ;;
      "MED:"*)    color="$FG"     size=36 line="${line#MED:}" ;;
    esac
    line="${line//\'/\\\'}"
    vf+="drawtext=fontfile=${FONT}:fontcolor=${color}:fontsize=${size}:x=60:y=${ypos}:text='${line}',"
  done
  IFS="$old_ifs"
  vf="${vf%,}"
  "$FFMPEG" -v error -y -f lavfi -i "$vf" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p "$out"
  echo "$out"
}

echo "🎬 Generating vibeOS commercial scenes..."

SC0=$(scene "s0_intro" 3 "
BIG:vibeOS
MED:
MED:the smart savings layer for OpenCode
DIM:
DIM:save money while you code. automatically.
")

SC1=$(scene "s1_problem" 4 "
HEADER:AI coding costs bleeding your wallet?
CYAN:
CYAN:  deepseek/deepseek-v4-pro   \$3.00/Mtok in
CYAN:  deepseek/deepseek-chat     \$0.14/Mtok out
CYAN:
GREEN:  The brain-tier burns cash on every edit.
GREEN:  Most edits don't need \$3/Mtok reasoning.
")

SC2=$(scene "s2_dashboard" 6 "
PROMPT:\$ trinity status
HEADER:[vibeOS-dashboard]
GREEN:Model:        brain  (deepseek/deepseek-chat)
CYAN:Quality:       Brain    Guard:  ACTIVE
YELLOW:Split:        70% brain / 30% worker (51 total)
GREEN:Decision:      CLOSED_GOOD  ↑ up
DIM:Savings:       \$138.42 total  |  \$112.90 delegation  |  \$25.52 cache
DIM:
YELLOW:Guards:  enforce=ON  flow=OFF  tdd=ON  lock=ON
")

SC3=$(scene "s3_delegate" 7 "
PROMPT:\$ edit src/index.ts
RED:
RED:🚫  Brain-tier direct write BLOCKED
YELLOW:
YELLOW:→  Delegate via Task subagent (cheap tier)
YELLOW:→  or run 'trinity set medium'
YELLOW:
GREEN:Saves ~\$0.034 per edit → \$138.42 lifetime
GREEN:Your most expensive model handles logic only.
DIM:   Worker tasks run on deepseek/deepseek-chat (\$0.14/Mtok)
")

SC4=$(scene "s4_modes" 8 "
PROMPT:\$ trinity mode quality
GREEN:✅  Mode → quality (enforce=strict, flow=strict, TDD=quality)
CYAN:
PROMPT:\$ trinity mode speed
GREEN:✅  Mode → speed (enforce=relaxed, flow=audit, TDD=lazy)
YELLOW:
PROMPT:\$ trinity mode budget
GREEN:✅  Mode → budget (cheap tier, minimal reasoning overhead)
CYAN:
HEADER:  quality · speed · budget · auto
DIM:    One command. Instant savings profile switch.
")

SC5=$(scene "s5_stress" 6 "
HEADER:Stress Pipeline
CYAN:
MED:▁▂▃▅▆█  — live stress gauge in your footer
CYAN:
YELLOW:Stress > 1.5 → auto-escalates to quality mode
YELLOW:Frustrated user? vibeOS protects your wallet
CYAN:
DIM:Detects urgency signals in user messages
DIM:Routes to appropriate tier automatically
")

SC6=$(scene "s6_flowtdd" 6 "
PROMPT:\$ trinity flow on
GREEN:✅  Flow enforcer → ON (audit mode)
CYAN:
PROMPT:\$ trinity tdd strict on
GREEN:✅  TDD strict → ON (TODO tests fail loudly)
YELLOW:
HEADER:Write safer code, automatically.
DIM:Flow enforcer checks edit patterns + extracts TODOs.
DIM:TDD enforcer generates test skeletons on file changes.
")

SC7=$(scene "s7_footer" 5 "
HEADER:Live Footer — always visible
CYAN:
GREEN:— ⚡  Quality: Brain  |  Provider: Deepseek
GREEN:|  Model: deepseek/deepseek-chat
GREEN:|  \$142.30 saved  |  Speed  |  VIBE ⚡ —
CYAN:
DIM:Model split  ·  Cumulative savings  ·  Trend arrow
DIM:Stress gauge  ·  Lock state  ·  Mode badge
")

SC8=$(scene "s8_cta" 4 "
BIG:vibeOS
MED:
MED:Free. Open Source. Saves real money.
GREEN:
CYAN:npm install vibeoscore
DIM:github.com/anomalyco/vibeOS
")

echo "🔧 Assembling timeline..."
TIMELINE="$TMP/timeline.txt"
for sc in "$SC0" "$SC1" "$SC2" "$SC3" "$SC4" "$SC5" "$SC6" "$SC7" "$SC8"; do
  echo "file '$sc'" >> "$TIMELINE"
done

echo "📹 Rendering desktop commercial (1920x1080)..."
DESKTOP_OUT="$OUT_DIR/vibeos-desktop-commercial.mp4"
"$FFMPEG" -v error -y -f concat -safe 0 -i "$TIMELINE" \
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -movflags +faststart \
  "$DESKTOP_OUT"
echo "✅ Desktop: $DESKTOP_OUT ($(du -h "$DESKTOP_OUT" | cut -f1))"

# Social version (9:16)
echo "📱 Rendering social commercial (1080x1920)..."
SOCIAL_OUT="$OUT_DIR/vibeos-social-commercial.mp4"
SW=1080 SH=1920

social_scene() {
  local name="$1" duration="$2" lines="$3"
  local out="$TMP/social_${name}.mp4"
  local vf="color=c=${BG}:s=${SW}x${SH}:d=${duration},"
  local y=120 idx=0
  local old_ifs="$IFS"
  IFS=$'\n'
  for line in $lines; do
    idx=$((idx+1))
    local ypos=$((y + (idx-1)*46))
    local color="$FG" size=30
    case "$line" in
      "PROMPT:"*) color="$PROMPT_COLOR" size=26 line="${line#PROMPT:}" ;;
      "HEADER:"*) color="$HEADER" size=40 line="${line#HEADER:}" ;;
      "GREEN:"*)  color="$GREEN"  size=30 line="${line#GREEN:}" ;;
      "CYAN:"*)   color="$CYAN"   size=30 line="${line#CYAN:}" ;;
      "YELLOW:"*) color="$YELLOW" size=30 line="${line#YELLOW:}" ;;
      "RED:"*)    color="$RED"    size=30 line="${line#RED:}" ;;
      "DIM:"*)    color="$DIM"    size=24 line="${line#DIM:}" ;;
      "BIG:"*)    color="$HEADER" size=56 line="${line#BIG:}" ;;
      "MED:"*)    color="$FG"     size=40 line="${line#MED:}" ;;
    esac
    line="${line//\'/\\\'}"
    vf+="drawtext=fontfile=${FONT}:fontcolor=${color}:fontsize=${size}:x=40:y=${ypos}:text='${line}',"
  done
  IFS="$old_ifs"
  vf="${vf%,}"
  "$FFMPEG" -v error -y -f lavfi -i "$vf" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p "$out"
  echo "$out"
}

S0=$(social_scene "s0" 2 "
BIG:vibeOS
MED:
MED:Save money while you code
DIM:
DIM:OpenCode plugin
")
S1=$(social_scene "s1" 3 "
HEADER:AI coding is expensive
CYAN:
CYAN:Brain tier: \$3.00/Mtok
CYAN:Worker tier: \$0.14/Mtok
YELLOW:
YELLOW:vibeOS auto-routes to
YELLOW:the cheapest capable model
")
S2=$(social_scene "s2" 4 "
HEADER:trinity status
GREEN:Full savings dashboard
CYAN:Live model split display
YELLOW:Cumulative \$ saved
DIM:Delegation enforcement guard
")
S3=$(social_scene "s3" 4 "
HEADER:Delegation Enforcement
RED:🚫 Brain-tier write BLOCKED
YELLOW:→ Workers handle edits
GREEN:→ Saves \$0.034 per edit
DIM:Lifetime: \$138.42 saved
")
S4=$(social_scene "s4" 3 "
HEADER:trinity mode
GREEN:quality · speed · budget
CYAN:One word to change
CYAN:your entire savings profile
")
S5=$(social_scene "s5" 3 "
HEADER:Stress Gauge ▁▂▃▅▆█
YELLOW:Frustrated? vibeOS knows.
GREEN:Auto-escalates to quality
DIM:Protects your wallet + sanity
")
S6=$(social_scene "s6" 3 "
HEADER:Flow + TDD Guards
GREEN:Write/edit pattern checks
GREEN:Auto test skeleton gen
DIM:Safer code, automatically
")
S7=$(social_scene "s7" 4 "
BIG:vibeOS
MED:Free · Open Source
GREEN:npm install vibeoscore
DIM:github.com/anomalyco/vibeOS
")

STIMELINE="$TMP/social_timeline.txt"
for sc in "$S0" "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7"; do
  echo "file '$sc'" >> "$STIMELINE"
done

"$FFMPEG" -v error -y -f concat -safe 0 -i "$STIMELINE" \
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
echo "║  Add BGM: ffmpeg -i output.mp4 -i bgm.mp3 ║"
echo "║    -filter_complex volume=0.25 -c:v copy  ║"
echo "╚════════════════════════════════════════════╝"
