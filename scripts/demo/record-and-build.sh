#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────
#  vibeOS Commercial — Full Pipeline
#  Usage:  ./record-and-build.sh
#
#  1. Runs the terminal demo (record with QuickTime)
#  2. Builds desktop (16:9) and social (9:16) versions
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUT_DIR"

echo "╔════════════════════════════════════════════════╗"
echo "║        vibeOS Commercial Pipeline               ║"
echo "╚════════════════════════════════════════════════╝"
echo

# ─── Check deps ─────────────────────────────────
echo "🔧 Checking dependencies..."
MISSING=()
command -v ffmpeg  >/dev/null 2>&1 || MISSING+=("ffmpeg (brew install ffmpeg)")
command -v ffprobe >/dev/null 2>&1 || MISSING+=("ffprobe (comes with ffmpeg)")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "❌ Missing tools:"
  for m in "${MISSING[@]}"; do echo "   - $m"; done
  echo
  echo "Install with: brew install ffmpeg"
  exit 1
fi

# ─── Step 1: Record ────────────────────────────
echo "🎬 STEP 1: Run the terminal demo"
echo "   Run this in a NEW terminal window:"
echo
echo "   bash $SCRIPT_DIR/commercial-record.sh"
echo
echo "   Then use QuickTime → File → New Screen Recording"
echo "   Crop to the terminal window and record the full demo."
echo "   Save as: scripts/demo/commercial-recording.mov"
echo
read -rp "   Press ENTER when recording is ready..." _

RECORDING="$SCRIPT_DIR/commercial-recording.mov"
if [[ ! -f "$RECORDING" ]]; then
  echo "❌ Recording not found at $RECORDING"
  echo "   Please save your QuickTime recording there and re-run."
  exit 1
fi

# ─── Step 2: Build Desktop ─────────────────────
echo
echo "🎬 STEP 2: Building desktop commercial (1920x1080)..."
bash "$SCRIPT_DIR/build-desktop-commercial.sh" "$RECORDING" "${BGM:-}"
DESKTOP_OUT="$OUT_DIR/vibeos-desktop-commercial.mp4"
mv -f vibeos-desktop-commercial.mp4 "$DESKTOP_OUT" 2>/dev/null || true
echo "   → $DESKTOP_OUT"

# ─── Step 3: Build Social ──────────────────────
echo
echo "📱 STEP 3: Building social commercial (1080x1920)..."
bash "$SCRIPT_DIR/build-social-commercial.sh" "$RECORDING" "${BGM:-}"
SOCIAL_OUT="$OUT_DIR/vibeos-social-commercial.mp4"
mv -f vibeos-social-commercial.mp4 "$SOCIAL_OUT" 2>/dev/null || true
echo "   → $SOCIAL_OUT"

# ─── Done ───────────────────────────────────────
echo
echo "╔════════════════════════════════════════════════╗"
echo "║  ✅ Commercials built!                         ║"
echo "║                                                ║"
echo "║  Desktop: $DESKTOP_OUT"
echo "║  Social:  $SOCIAL_OUT"
echo "║                                                ║"
echo "║  Optional: add music with --bgm flag           ║"
echo "╚════════════════════════════════════════════════╝"
