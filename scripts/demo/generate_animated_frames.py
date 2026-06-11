#!/usr/bin/env python3
"""Generate full-screen terminal animation frames for vibeOS commercial."""

import os, math
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "output", "frames")
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 1920, 1080
SW, SH = 1080, 1920

BG   = (14, 14, 18)
FG   = (220, 220, 220)
GRN  = (0, 221, 102)
CYN  = (0, 204, 255)
YLW  = (255, 170, 0)
RED  = (255, 68, 68)
DIM  = (102, 102, 136)
WHT  = (255, 255, 255)
ORG  = (255, 136, 0)
BLK_BG = (45, 12, 12)

FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 24)
FONT_BIG = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 40)
FONT_SM = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
FONT_XS = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)

LINE_H = 28
PAD_X = 40
PAD_Y = 50

def draw_lines(draw, lines, start_y, cursor_line=None, cursor_col=None):
    """Draw lines of text. Returns y after last line."""
    y = start_y
    for i, line in enumerate(lines):
        if not line:
            y += LINE_H
            continue
        color = FG
        text = line
        if line.startswith(">"): color, text = GRN, line[1:]
        elif line.startswith("!"): color, text = RED, line[1:]
        elif line.startswith("="): color, text = CYN, line[1:]
        elif line.startswith("+"): color, text = GRN, line[1:]
        elif line.startswith("-"): color, text = DIM, line[1:]
        elif line.startswith("*"): color, text = YLW, line[1:]
        elif line.startswith("#"): color, text = ORG, line[1:]
        elif line.startswith("@"): color, text = WHT, line[1:]

        # Handle background highlight for delegation block
        if text.startswith("BLOCK_BG"):
            draw.rectangle([PAD_X-4, y-2, W-PAD_X+4, y+LINE_H-2], fill=BLK_BG)
            text = text[8:]

        draw.text((PAD_X, y), text, fill=color, font=FONT)

        # Draw blinking cursor
        if cursor_line is not None and i == cursor_line:
            prefix = ""
            c = color
            if line.startswith(">"): prefix, c = ">", GRN
            prefix_w = draw.textlength(prefix, font=FONT) if prefix else 0
            cursor_x = PAD_X + prefix_w + (cursor_col or 0) * 13
            draw.text((cursor_x, y), "_", fill=color, font=FONT)

        y += LINE_H
    return y

# ─── Scene generator ──────────────────────────
# Returns list of (lines, duration_frames) tuples
# Each tuple = one "frame state" shown for N frames at 30fps

def scene_launch():
    """Scene 1: Launch opencode, vibeOS loads"""
    frames = []
    for cols in [2, 5, 9, 13, 17, 22, 28, 30]:
        frames.append(([">~/project % openco"[:cols] + "_"], 3))
    frames.append(([">~/project % opencode"], 8))
    frames.append(([">~/project % opencode", ""], 5))
    frames.append(([">~/project % opencode", "", "=vibeOS v3.0  |  trinity runtime active"], 8))
    frames.append(([">~/project % opencode", "", "=vibeOS v3.0  |  trinity runtime active",
                     "+Brain: deepseek/deepseek-chat   Medium: deepseek/flash   Cheap: deepseek/chat"], 10))
    frames.append(([">~/project % opencode", "", "=vibeOS v3.0  |  trinity runtime active",
                     "+Brain: deepseek/deepseek-chat   Medium: deepseek/flash   Cheap: deepseek/chat",
                     "*Guards: enforce=ON  flow=OFF  tdd=ON strict  lock=ON  blackbox=ON"], 12))
    frames.append(([">~/project % opencode", "", "=vibeOS v3.0  |  trinity runtime active",
                     "+Brain: deepseek/deepseek-chat   Medium: deepseek/flash   Cheap: deepseek/chat",
                     "*Guards: enforce=ON  flow=OFF  tdd=ON strict  lock=ON  blackbox=ON",
                     "", "-—  Quality: Brain | Provider: Deepseek | Model: deepseek/deepseek-chat | $0.00 saved | VIBE  —"], 20))
    return frames

def scene_dashboard():
    """Scene 2: trinity status — full dashboard"""
    lines = [
        ">~/project % trinity status",
        "",
        "@[vibeOS-dashboard]",
        "",
        "+Model:        brain  (deepseek/deepseek-chat)",
        "=Quality:       Brain    Guard:  ACTIVE  |  Split: 70% brain / 30% worker",
        "+Decision:      CLOSED_GOOD    ↑ momentum up",
        "",
        "#All-time Savings:",
        "+  Total:        $142.30  (↑ +$3.88 this session)",
        "+  Delegation:   $112.90  (4,212 write/edit blocks)",
        "+  Cache:        $25.52   (62 scratchpad entries)",
        "+  Context7:     $3.88    (missed: $1.20)",
        "",
        "*Guards:  enforce=ON | flow=OFF | tdd=ON strict | lock=ON",
        "=Stress:  ▂ calm (0.34)    Blackbox:  ON  CLOSED_GOOD",
        "",
        "Tiers:",
        ">  brain:  deepseek/deepseek-chat  *",
        "-  medium: deepseek/flash",
        "-  cheap:  deepseek/chat",
        "",
        "-—  Quality: Brain | Provider: Deepseek | $142.30 saved | Speed | VIBE  —",
    ]
    # Show it appearing
    frames = []
    for n in range(3, len(lines)+1, 3):
        frames.append((lines[:n], 3))
    frames.append((lines, 40))
    return frames

def scene_block():
    """Scene 3: Delegation enforcement block"""
    lines = [
        ">~/project % edit src/index.ts  # user tries to write directly",
        "",
        "!——————————————————————————————————————————————————————————",
        "!  🚫  BRAIN-TIER DIRECT WRITE BLOCKED",
        "!",
        "!  vibeOS delegation enforcement prevented a $0.034 call",
        "!  to your most expensive model (deepseek/deepseek-chat).",
        "!",
        "!  →  Task subagent handles the edit on CHEAP tier",
        "!  →  Same result.  $0.14/Mtok instead of $3.00/Mtok.",
        "!  →  That's 95% cheaper.  For the same output.",
        "!",
        "!  Session: +$0.034  |  All-time: $142.33  |  4,213 blocks",
        "!——————————————————————————————————————————————————————————",
        "",
        ">~/project %",
        "",
        "#  Every blocked brain-tier edit saves ~$0.034.",
        "#  4,213 blocks later = $142.30 in your pocket.",
        "#  Automatic.  Transparent.  Zero effort.",
        "",
        "-—  Quality: Brain | Provider: Deepseek | $142.33 saved | Speed | VIBE  —",
    ]
    frames = []
    for n in range(2, len(lines)+1, 4):
        frames.append((lines[:n], 3))
    frames.append((lines, 25))
    return frames

def scene_zoom_savings():
    """Scene 3b: Zoom on the savings number"""
    lines = [
        "",
        "",
        "@    ZOOM:  THE NUMBERS THAT MATTER",
        "",
        "+    $0.034   —  saved every time a brain-tier edit is blocked",
        "+    4,213    —  total edits delegated since install",
        "+    $112.90  —  delegation savings: brain → cheap routing",
        "+    $25.52   —  cache savings: repeated context lookups are FREE",
        "+    $3.88    —  Context7 savings: doc lookups redirected",
        "",
        "=    $142.30  —  TOTAL SAVED.  REAL MONEY.  ZERO EFFORT.",
        "",
        "#    Without vibeOS:  estimated $480+ in API costs.",
        "#    With vibeOS:     $142.30 spent.  That's 70% saved.",
        "#    Every turn.  Every session.  Every project.",
        "",
    ]
    return [(lines, 60)]

def scene_modes():
    """Scene 4: Mode switching"""
    lines = [
        ">~/project % trinity mode quality",
        "+  Mode → quality  (enforce=strict, flow=strict, TDD=quality, tier=brain)",
        "",
        ">~/project % trinity mode speed",
        "+  Mode → speed  (enforce=relaxed, flow=audit, TDD=lazy, tier=medium)",
        "",
        ">~/project % trinity mode budget",
        "+  Mode → budget  (enforce=relaxed, flow=audit, TDD=lazy, tier=cheap)",
        "",
        "=  One word.  Your entire savings profile changes instantly.",
        "=  quality  ·  speed  ·  budget  ·  auto",
        "",
        "-—  Quality: Medium | Provider: Deepseek | $142.38 saved | Speed | VIBE  —",
    ]
    frames = []
    for n in range(1, len(lines)+1, 2):
        frames.append((lines[:n], 2))
    frames.append((lines, 35))
    return frames

def scene_cache():
    """Scene 5: Cache + worker delegation cost breakdown"""
    lines = [
        ">~/project % # vibeOS cache kicks in on repeated file reads...",
        "",
        "Scratchpad cache hit:  README.md        (+$0.003 saved)",
        "Scratchpad cache hit:  AGENTS.md         (+$0.005 saved)",
        "Scratchpad cache hit:  package.json      (+$0.004 saved)",
        "Scratchpad cache hit:  tsconfig.json     (+$0.003 saved)",
        "",
        "* 62 entries cached  |  $25.52 total cache savings",
        "",
        ">~/project % # Speed mode with auto-delegation...",
        "",
        "Task (deepseek/chat):   write test file     $0.007  ·  3.2s",
        "Brain (deepseek/chat):  review diff         $0.005  ·  0.8s",
        "",
        "+Total cost: $0.012  —  vs $0.048 without delegation  =  4× cheaper",
        "",
        "-—  Quality: Medium | Provider: Deepseek | $142.42 saved | Speed | VIBE  —",
    ]
    frames = []
    for n in range(1, len(lines)+1, 2):
        frames.append((lines[:n], 2))
    frames.append((lines, 30))
    return frames

def scene_stress():
    """Scene 6: Stress pipeline"""
    lines = [
        ">~/project % WHY IS THIS NOT WORKING I'VE BEEN TRYING FOR AN HOUR",
        "",
        "#  Stress signal detected:  ▅ elevated (1.72)",
        "#  →  Auto-escalating to QUALITY mode",
        "#  →  Switching tier:  cheap → brain",
        "#  →  Full reasoning power engaged for frustrated user",
        "",
        "*  vibeOS knows when you're stressed.",
        "*  Protects your results with quality mode.",
        "*  Protects your wallet by returning to cheap when calm.",
        "",
        ">~/project % #  ... problem solved.  stress drops back to ▂ calm.",
        "",
        "-—  Quality: Brain | Provider: Deepseek | $142.48 saved | Quality | VIBE  —",
    ]
    frames = []
    for n in range(1, 5):
        frames.append((lines[:n], 6))
    for n in range(5, len(lines)+1, 2):
        frames.append((lines[:n], 3))
    frames.append((lines, 25))
    return frames

def scene_footer():
    """Scene 7: Footer tracking over time"""
    lines = [
        ">~/project %  #  Every assistant turn appends the live footer:",
        "",
        "Turn  1:  — ⚡ Quality: Brain | deepseek/chat     |  $0.00   | VIBE ⚡ —",
        "Turn  3:  — ⚡ Quality: Medium | deepseek/flash   |  $0.34   | VIBE ⚡ —",
        "Turn  7:  — ⚡ Quality: Cheap | deepseek/chat     |  $1.20   | VIBE ⚡ —",
        "Turn 12:  — ⚡ Quality: Medium | deepseek/flash   |  $18.40  | VIBE ⚡ —",
        "Turn 27:  — ⚡ Quality: Brain | deepseek/chat     |  $72.30  | VIBE ⚡ —",
        "Turn 51:  — ⚡ Quality: Brain | deepseek/chat     |  $142.30 | VIBE ⚡ —",
        "",
        "=  Same project.  Same features.  Auto-saved $142.30.",
        "=  Without vibeOS:  estimated $480+ in API costs.",
        "=  That's 70% saved.  Automatically.",
        "",
        "#  The footer updates every single turn.",
        "#  You always see:  tier, model, savings, mode, stress.",
        "",
        "-—  Quality: Brain | Provider: Deepseek | $142.30 saved | Quality | VIBE  —",
    ]
    frames = []
    for n in range(1, 6, 2):
        frames.append((lines[:n], 3))
    for n in range(6, len(lines)+1, 2):
        frames.append((lines[:n], 2))
    frames.append((lines, 30))
    return frames

def scene_cta():
    """Scene 8: Call to action"""
    lines = [
        "",
        "",
        "",
        "@              vibeOS",
        "@   The Smart Savings Layer for OpenCode",
        "",
        "+       Free.  Open Source.  Saves real money.",
        "",
        "=       $ npm install vibeoscore",
        "-       github.com/anomalyco/vibeOS",
        "",
        "#       Code smart.  Save automatically.",
        "",
        "#       #opensource  #devtools  #ai  #cost-saving",
    ]
    return [(lines, 60)]

# ─── Render a frame ────────────────────────────
def render_frame(lines, cursor_line=None, cursor_col=None, w=W, h=H):
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    draw_lines(draw, lines, PAD_Y, cursor_line, cursor_col)
    return img

# ─── Generate all frames ────────────────────────
scenes = [
    ("s1", scene_launch()),
    ("s2", scene_dashboard()),
    ("s3", scene_block()),
    ("s4", scene_zoom_savings()),
    ("s5", scene_modes()),
    ("s6", scene_cache()),
    ("s7", scene_stress()),
    ("s8", scene_footer()),
    ("s9", scene_cta()),
]

frame_idx = 0
for scene_name, frames in scenes:
    for fi, (lines, dur_frames) in enumerate(frames):
        # Render cursor state
        cursor_line = None
        cursor_col = None
        if dur_frames <= 5 and len(lines) > 0:
            # During fast frames, show cursor on last line
            last_line = lines[-1] if lines else ""
            if last_line.startswith(">"):
                cursor_line = len(lines) - 1
                cursor_col = len(last_line) - 1

        img = render_frame(lines, cursor_line, cursor_col)
        path = os.path.join(OUT_DIR, f"anim_{scene_name}_{fi:03d}.png")
        img.save(path)

        # Write timing: frame duration in 1/30s units
        timing_path = os.path.join(OUT_DIR, f"anim_timing.txt")
        with open(timing_path, "a") as f:
            f.write(f"file '{path}'\n")
            f.write(f"duration {dur_frames/30.0:.4f}\n")

        frame_idx += 1
        if frame_idx % 20 == 0:
            print(f"  {frame_idx} frames generated...")

# Last frame duplicate for concat spec
last_scene, last_frames = scenes[-1]
last_lines, _ = last_frames[-1]
last_path = os.path.join(OUT_DIR, f"anim_{last_scene}_{len(last_frames)-1:03d}.png")
timing_path = os.path.join(OUT_DIR, f"anim_timing.txt")
with open(timing_path, "a") as f:
    f.write(f"file '{last_path}'\n")

print(f"\n  {frame_idx} animation frames written to {OUT_DIR}")
print(f"  Timing file: {timing_path}")
