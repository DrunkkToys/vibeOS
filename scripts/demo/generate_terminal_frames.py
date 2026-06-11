#!/usr/bin/env python3
"""Generate realistic macOS terminal frames for vibeOS commercial."""

import os, math
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "output", "frames")
os.makedirs(OUT_DIR, exist_ok=True)

# ─── Colors ────────────────────────────────────
TERM_BG  = (26, 26, 28)    # Terminal background
TITLE_BG = (45, 45, 45)     # Title bar
BORDER   = (51, 51, 51)     # Window border
RED_DOT  = (255, 95, 87)
YEL_DOT  = (254, 188, 46)
GRN_DOT  = (40, 200, 64)
WHITE    = (220, 220, 220)
GREEN    = (0, 221, 102)
CYAN     = (0, 204, 255)
YELLOW   = (255, 170, 0)
RED      = (255, 68, 68)
DIM      = (102, 102, 136)
BRIGHT   = (255, 255, 255)
ORANGE   = (255, 136, 0)
BLOCK_BG = (50, 10, 10)    # Delegation block bg
GRAY     =(128, 128, 140)

# ─── Fonts ─────────────────────────────────────
FONT_REG = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 22)
FONT_SM  = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
FONT_TITLE = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16)
FONT_ZOOM = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 36)
FONT_BIG  = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 56)

# ─── Terminal window constants ─────────────────
TITLE_H = 32
BORDER_W = 2
PADDING = 16
LINE_H = 26
FONT_W = 13  # Approx char width for Menlo 22pt

def draw_terminal_window(draw, x, y, w, h, title="Terminal — bash — 80×24"):
    """Draw macOS-style terminal chrome."""
    # Shadow / outer border
    draw.rectangle([x, y, x+w, y+h], fill=BORDER)
    # Title bar
    draw.rectangle([x+1, y+1, x+w-1, y+TITLE_H], fill=TITLE_BG)
    # Dots
    dot_y = y + TITLE_H//2 - 6
    draw.ellipse([x+12, dot_y, x+24, dot_y+12], fill=RED_DOT)
    draw.ellipse([x+32, dot_y, x+44, dot_y+12], fill=YEL_DOT)
    draw.ellipse([x+52, dot_y, x+64, dot_y+12], fill=GRN_DOT)
    # Title text
    bbox = draw.textbbox((0,0), title, font=FONT_TITLE)
    tw = bbox[2] - bbox[0]
    draw.text((x + (w-tw)//2, y + 8), title, fill=GRAY, font=FONT_TITLE)
    # Terminal content area
    content_x, content_y = x+1, y+TITLE_H
    content_w, content_h = w-2, h - TITLE_H - 1
    draw.rectangle([content_x, content_y, content_x+content_w, content_y+content_h], fill=TERM_BG)

def draw_terminal_text(draw, x, y, lines, max_width=None):
    """Draw terminal text lines within a terminal window. Returns next y."""
    for line in lines:
        color = WHITE
        text = line
        if line.startswith(">"):  # Prompt
            color, text = GREEN, line[1:]
        elif line.startswith("!"):  # Red
            color, text = RED, line[1:]
        elif line.startswith("="):  # Cyan
            color, text = CYAN, line[1:]
        elif line.startswith("+"):  # Green
            color, text = GREEN, line[1:]
        elif line.startswith("-"):  # Dim
            color, text = DIM, line[1:]
        elif line.startswith("*"):  # Yellow
            color, text = YELLOW, line[1:]
        elif line.startswith("#"):  # Orange
            color, text = ORANGE, line[1:]
        draw.text((x + 8, y), text, fill=color, font=FONT_REG)
        y += LINE_H
    return y

def make_frame(width, height, title, lines, name, bg=(10,10,16)):
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    tw = width - 60
    th = height - 60
    draw_terminal_window(draw, 30, 30, tw, th, title)
    draw_terminal_text(draw, 30 + 1, 30 + TITLE_H + 8, lines)
    path = os.path.join(OUT_DIR, name + ".png")
    img.save(path)
    return path

def make_zoom_frame(width, height, title, lines, highlight_y, highlight_h, name):
    """Zoomed-in frame with a highlighted area."""
    img = Image.new("RGB", (width, height), (10, 10, 16))
    draw = ImageDraw.Draw(img)
    tw = width - 60
    th = height - 60
    draw_terminal_window(draw, 30, 30, tw, th, title)
    # Draw lines but highlight specific region
    y = 30 + TITLE_H + 8
    for i, line in enumerate(lines):
        color = WHITE
        text = line
        if line.startswith(">"): color, text = GREEN, line[1:]
        elif line.startswith("!"): color, text = RED, line[1:]
        elif line.startswith("="): color, text = CYAN, line[1:]
        elif line.startswith("+"): color, text = GREEN, line[1:]
        elif line.startswith("-"): color, text = DIM, line[1:]
        elif line.startswith("*"): color, text = YELLOW, line[1:]
        elif line.startswith("#"): color, text = ORANGE, line[1:]
        if highlight_y <= i <= highlight_y + highlight_h:
            draw.rectangle([30+1, y-2, 30+tw-1, y+LINE_H-2], fill=(40, 50, 40))
        draw.text((30 + 1 + 8, y), text, fill=color, font=FONT_REG)
        y += LINE_H
    # Draw a magnifying glass or highlight border
    hx = 30 + 1
    hy_pos = 30 + TITLE_H + 8 + highlight_y * LINE_H
    hh = (highlight_h + 1) * LINE_H
    draw.rectangle([hx, hy_pos-4, hx+tw-1, hy_pos+hh+4], outline=GREEN, width=2)
    path = os.path.join(OUT_DIR, name + ".png")
    img.save(path)
    return path

# ─── SCENE 1: OpenCode launch ──────────────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % opencode",
"I",
"vibeOS v2.9.1  |  trinity runtime active",
"Brain: deepseek/deepseek-chat   Medium: deepseek/deepseek-v4-flash   Cheap: deepseek/deepseek-chat",
"Guards: enforce=ON  flow=OFF  tdd=ON strict",
"-Mode: budget  |  Cache: 62 entries  |  Blackbox: ON",
"",
">~/project %",
"",
"", "",
"", "", "",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-chat  |  $0.00 saved  |  Speed  |  VIBE  —",
], "s1_launch")

# ─── SCENE 2: trinity status (full dashboard) ──
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % trinity status",
"",
"=[vibeOS-dashboard]",
"",
"+Model:        brain  (deepseek/deepseek-chat)",
"=Quality:       Brain    Guard:  ACTIVE",
"*Split:        70% brain / 30% worker  (51 tasks total)",
"+Decision:      CLOSED_GOOD    ↑ momentum up",
"",
"Savings (all-time):",
"+  Total:        $142.30  (↑ +$3.88 this session)",
"+  Delegation:   $112.90",
"+  Cache:        $25.52",
"+  Context7:     $3.88  (missed: $1.20)",
"",
"*Guards:  enforce=ON | flow=OFF | tdd=ON strict | lock=ON",
"=Stress:  ▂ calm  (0.34)",
"",
"Tiers:",
">  brain:  deepseek/deepseek-chat  *",
"-  medium: deepseek/deepseek-v4-flash",
"-  cheap:  deepseek/deepseek-chat",
"",
">~/project %",
"",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-pro  |  $142.30 saved  |  Speed  |  VIBE  —",
], "s2_dashboard")

# ─── SCENE 3: Delegation block ─────────────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % I need you to edit src/index.ts",
"",
"The assistant tries to write directly to the file...",
"",
"!——————————————————————————————————————————————",
"!  🚫  Brain-tier direct write BLOCKED",
"!",
"!  vibeOS delegation enforcement prevented a $0.034",
"!  write/edit call to deepseek/deepseek-chat",
"!",
"!  →  Delegate via Task subagent (cheap tier)",
"!  →  or run 'trinity set medium' to unlock",
"!",
"!  Savings this session: +$0.034  |  Lifetime: $142.33",
"!——————————————————————————————————————————————",
"",
">~/project %",
"",
"The cheap worker handles the edit at $0.14/Mtok instead of $3.00/Mtok.",
"Same result, 95% cheaper.  That's how vibeOS saves.",
"",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-pro  |  $142.33 saved  |  Speed  |  VIBE  —",
], "s3_block")

# ─── SCENE 3B: ZOOM on the savings ─────────────
make_zoom_frame(1920, 1080, "Terminal — bash — ~/project  🔍 ZOOM: Savings",
[
">~/project % I need you to edit src/index.ts",
"",
"The assistant tries to write directly to the file...",
"",
"!——————————————————————————————————————————————",
"!  🚫  Brain-tier direct write BLOCKED",
"!",
"!  vibeOS delegation enforcement prevented a $0.034",
"!  write/edit call to deepseek/deepseek-chat",
"!",
"!  →  Delegate via Task subagent (cheap tier)",
"!  →  or run 'trinity set medium' to unlock",
"!",
"!  Savings this session: +$0.034  |  Lifetime: $142.33",
"!——————————————————————————————————————————————",
"",
"#  $0.034 per edit  ×  4,200 edits blocked",
"#  =  $142.30 saved  —  real money, zero effort.",
"",
">~/project %",
"",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-pro  |  $142.33 saved  |  Speed  |  VIBE  —",
], 9, 5, "s3b_zoom_savings")

# ─── SCENE 4: Mode switching ───────────────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % trinity mode quality",
"",
"+  Mode → quality",
"+  enforce=strict  flow=strict  TDD=quality  tier=brain",
"",
">~/project % trinity mode speed",
"",
"+  Mode → speed",
"+  enforce=relaxed  flow=audit  TDD=lazy  tier=medium",
"",
">~/project % trinity mode budget",
"",
"+  Mode → budget",
"+  enforce=relaxed  flow=audit  TDD=lazy  tier=cheap",
"",
"=  One word.  Entire savings profile changed instantly.",
"",
"-—  Quality: Medium  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-flash  |  $142.38 saved  |  Speed  |  VIBE  —",
], "s4_modes")

# ─── SCENE 5: Cache + Speed ───────────────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % # vibeOS cache kicks in on repeated lookups...",
"",
"Scratchpad cache hit:  README.md summary  (+$0.003 saved)",
"Scratchpad cache hit:  AGENTS.md rules     (+$0.005 saved)",
"Scratchpad cache hit:  package.json deps   (+$0.004 saved)",
"",
"* 62 cache entries  |  $25.52 total cache savings",
"",
">~/project % # Speed mode with caching...",
"",
"vibeOS auto-mode: CHEAP tier for exploration, BRAIN for final review.",
"",
">~/project % write the test file for the new feature",
"",
"Task subagent (deepseek/deepseek-chat):  $0.14/Mtok",
"  →  test written in 3.2s  |  cost: $0.007",
"Brain review (deepseek/deepseek-chat):  $3.00/Mtok",
"  →  approved in 0.8s  |  cost: $0.005",
"",
"+Total cost: $0.012  (vs $0.048 without delegation — 4x cheaper!)",
"",
"-—  Quality: Medium  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-flash  |  $142.42 saved  |  Speed  |  VIBE  —",
], "s5_cache_speed")

# ─── SCENE 5B: Zoom on cache savings ───────────
make_zoom_frame(1920, 1080, "Terminal — bash — ~/project  🔍 ZOOM: Cache Hits",
[
">~/project % # vibeOS cache kicks in on repeated lookups...",
"",
"Scratchpad cache hit:  README.md summary  (+$0.003 saved)",
"Scratchpad cache hit:  AGENTS.md rules     (+$0.005 saved)",
"Scratchpad cache hit:  package.json deps   (+$0.004 saved)",
"",
"* 62 cache entries  |  $25.52 total cache savings",
"",
"#  Every repeated context lookup?  Free.",
"#  File you read twice?  Cached.  Prompt you reuse?  Cached.",
"#  $25.52 saved just from NOT re-reading files.",
"",
"",
"",
"",
"-—  Quality: Medium  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-flash  |  $142.42 saved  |  Speed  |  VIBE  —",
], 2, 8, "s5b_zoom_cache")

# ─── SCENE 6: Stress Gauge ────────────────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % WHY IS THIS NOT WORKING I'VE BEEN TRYING FOR AN HOUR",
"",
"The stress pipeline detects urgency...",
"",
"#  Stress:  ▅ elevated (1.72)",
"#  →  Auto-escalating to QUALITY mode",
"#  →  Switching tier: cheap → brain",
"#  →  User is frustrated — full reasoning power engaged",
"",
"*  vibeOS knows when you're stressed.",
"*  It protects your results (quality mode) AND your wallet (back to cheap when calm).",
"",
">~/project % # ... problem solved. stress drops back to ▂ calm.",
"",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-v4-pro  |  $142.48 saved  |  Quality  |  VIBE  —",
], "s6_stress")

# ─── SCENE 7: Footer in action (dense) ────────
make_frame(1920, 1080, "Terminal — bash — ~/project",
[
">~/project % # Every single assistant turn appends the live footer:",
"",
"Turn 1:  — ⚡ Quality: Brain | Model: deepseek/deepseek-chat | $0.00 | VIBE ⚡ —",
"Turn 2:  — ⚡ Quality: Brain | Model: deepseek/deepseek-chat | $0.12 | VIBE ⚡ —",
"Turn 3:  — ⚡ Quality: Medium | Model: deepseek/deepseek-v4-flash | $0.34 | VIBE ⚡ —",
"Turn 4:  — ⚡ Quality: Cheap | Model: deepseek/deepseek-chat | $0.56 | VIBE ⚡ —",
"Turn 5:  — ⚡ Quality: Brain | Model: deepseek/deepseek-v4-pro | $1.20 | VIBE ⚡ —",
"Turn 12: — ⚡ Quality: Medium | Model: deepseek/deepseek-v4-flash | $52.40 | VIBE ⚡ —",
"Turn 27: — ⚡ Quality: Brain | Model: deepseek/deepseek-chat | $114.80 | VIBE ⚡ —",
"Turn 51: — ⚡ Quality: Brain | Model: deepseek/deepseek-chat | $142.30 | VIBE ⚡ —",
"",
"=  Same project.  Same features.  Auto-saved $142.30.",
"=  Without vibeOS:  estimated $480+ in API costs.",
"=  That's 70% saved.  Automatically.",
"",
"#  The footer updates every single turn.",
"#  You always know: tier, model, savings, mode, stress.",
"",
"",
"",
"-—  Quality: Brain  |  Provider: Deepseek  |  Model: deepseek/deepseek-chat  |  $142.30 saved  |  Quality  |  VIBE  —",
], "s7_footer")

# ─── SCENE 8: CTA ─────────────────────────────
make_frame(1920, 1080, "Terminal — bash —",
[
"┌─────────────────────────────────────────────────────────┐",
"│                                                         │",
"│                    vibeOS                               │",
"│           The Smart Savings Layer for OpenCode          │",
"│                                                         │",
"│    Free.  Open Source.  Saves real money.               │",
"│                                                         │",
"│    $ npm install vibeoscore                             │",
"│    github.com/anomalyco/vibeOS                          │",
"│                                                         │",
"│    Code smart.  Save automatically.                     │",
"│                                                         │",
"│    #opensource #devtools #ai #cost-saving               │",
"│                                                         │",
"└─────────────────────────────────────────────────────────┘",
"",
"",
"",
"",
], "s8_cta")

# ─── SOCIAL VERSION (9:16 vertical) ────────────
# Similar but vertical layout with bigger text

def make_social_frame(width, height, title, lines, name):
    img = Image.new("RGB", (width, height), (10, 10, 16))
    draw = ImageDraw.Draw(img)
    tw = width - 40
    th = height - 40
    draw_terminal_window(draw, 20, 20, tw, th, title)
    # Use smaller line height for compact vertical
    y = 20 + TITLE_H + 12
    f = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 20)
    lh = 24
    for line in lines:
        color = WHITE
        text = line
        if line.startswith(">"): color, text = GREEN, line[1:]
        elif line.startswith("!"): color, text = RED, line[1:]
        elif line.startswith("="): color, text = CYAN, line[1:]
        elif line.startswith("+"): color, text = GREEN, line[1:]
        elif line.startswith("-"): color, text = DIM, line[1:]
        elif line.startswith("*"): color, text = YELLOW, line[1:]
        elif line.startswith("#"): color, text = ORANGE, line[1:]
        draw.text((20 + 1 + 6, y), text, fill=color, font=f)
        y += lh
    path = os.path.join(OUT_DIR, name + ".png")
    img.save(path)
    return path

make_social_frame(1080, 1920, "Terminal — bash —",
[
">$ opencode",
"",
"vibeOS v2.9.1",
"Brain: deepseek/deepseek-chat",
"Guards: enforce=ON tdd=ON",
"",
">$ trinity status",
"",
"+Total: $142.30 saved",
"+Delegation: $112.90",
"+Cache: $25.52",
"+Context7: $3.88",
"",
">$ # Write an edit...",
"",
"!BRAIN WRITE BLOCKED",
"!→ Worker handles edit",
"!+$0.034 saved this turn",
"",
"=Without vibeOS: $480+",
"=With vibeOS:   $142",
"=That's 70% saved",
"",
">$ trinity mode quality",
"+Full reasoning engaged",
"",
">$ trinity mode speed",
"+Budget tier, fast results",
"",
"#vibeOS saves real money",
"#automatically, every turn",
"",
"npm install vibeoscore",
"github.com/anomalyco/vibeOS",
"",
],
"soc_s1_main")

make_social_frame(1080, 1920, "Terminal — bash — 🔍 ZOOM: The Numbers",
[
"",
"",
"Every blocked brain-tier edit:",
"",
"+$0.034 saved",
"",
"Every cache hit:",
"",
"+$0.003 - $0.005 saved",
"",
"Per session (avg):",
"",
"+$3.88 saved",
"",
"All time:",
"",
"+$142.30 saved",
"",
"=That's real money.",
"=Zero effort. Auto-magic.",
"",
"",
"npm install vibeoscore",
],
"soc_s2_zoom")

make_social_frame(1080, 1920, "Terminal — bash — CTA",
[
"",
"",
"",
"     vibeOS",
"",
"  Free. Open Source.",
"  Saves real money.",
"",
"  npm install vibeoscore",
"  github.com/anomalyco/vibeOS",
"",
"",
"#opensource #devtools",
"#ai #cost-saving",
"",
],
"soc_s3_cta")

print(f"\n  All terminal frames generated in {OUT_DIR}")
print(f"  Total: 8 desktop + 3 social frames")
