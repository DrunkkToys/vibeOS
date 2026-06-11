#!/usr/bin/env python3
"""Full-screen terminal commercial frames — edge-to-edge, dense, fast."""

import os
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

FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 28)
FONT_BIG = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 44)

LINE_H = 34
PAD_X = 24
PAD_Y = 24
CHARS_PER_LINE = 100  # ~1920 / ~19px char width

def draw_lines(draw, lines, y0, w=W, h=H):
    y = y0
    for line in lines:
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
        font = FONT_BIG if line.startswith("@") else FONT
        draw.text((PAD_X, y), text, fill=color, font=font)
        y += LINE_H
    return y

def render(lines, name, w=W, h=H):
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    draw_lines(draw, lines, PAD_Y, w, h)
    path = os.path.join(OUT_DIR, name + ".png")
    img.save(path)
    return path

def pad_bottom(lines, target_lines=30):
    """Pad scene with empty lines so content reaches ~85% of screen height."""
    while len(lines) < target_lines:
        lines.append("")
    return lines

def render_typing_scene(base_lines, name_prefix, w=W, h=H):
    """Generate progressive reveal frames for typing effect."""
    timing = []
    # Show empty screen first
    path = render([], f"{name_prefix}_000", w, h)
    timing.append((path, 0.1))
    # Progressive reveal: 2-3 lines at a time
    for n in range(1, len(base_lines) + 1, 2):
        path = render(base_lines[:n], f"{name_prefix}_{n:03d}", w, h)
        dur = 0.08 if n < 6 else 0.15
        timing.append((path, dur))
    # Full scene holds longer for reading
    path = render(base_lines, f"{name_prefix}_final", w, h)
    timing.append((path, 1.5))
    return timing

def make_scene(name, lines, w=W, h=H):
    """Single static scene with padding."""
    lines = pad_bottom(lines)
    return render(lines, name, w, h)

# ──────────────────────────────────────────────────
#  DESKTOP SCENES (1920x1080) — dense, edge-to-edge
# ──────────────────────────────────────────────────

# Reset timing file
timing_path = os.path.join(OUT_DIR, "fullscreen_timing.txt")
open(timing_path, "w").close()

all_timing = []

# S1: Launch (typing effect)
s1 = [
    ">~/project % opencode",
    "",
    "=vibeOS v3.0  |  trinity runtime active",
    "+Brain: deepseek/deepseek-chat   Medium: deepseek/flash   Cheap: deepseek/chat",
    "*Guards: enforce=ON  flow=OFF  tdd=ON strict  lock=ON  blackbox=ON",
    "*Stress: ▂ calm  |  Mode: budget  |  Cache: 62 entries",
    "",
    ">~/project %",
    "",
    "-—  Quality: Brain | Provider: Deepseek | Model: deepseek/deepseek-chat | $0.00 saved | VIBE  —",
]
for path, dur in render_typing_scene(s1, "s1"):
    all_timing.append((path, dur))

# S2: trinity status dashboard
s2 = [
    ">~/project % trinity status",
    "",
    "@[vibeOS-dashboard]",
    "",
    "+Model:        brain  (deepseek/deepseek-chat)",
    "=Quality:       Brain    Guard:  ACTIVE  |  Split: 70% brain / 30% worker",
    "*Mode:          budget   |  Blackbox:  ON  |  Stress: ▂ calm (0.34)",
    "+Decision:      CONVERGING  ↑ momentum",
    "",
    "#All-time Savings:",
    "+  Total:        $142.30  (↑ +$3.88 this session)",
    "+  Delegation:   $112.90  (4,212 write/edit blocks — brain→cheap routing)",
    "+  Cache:        $25.52   (62 scratchpad cache hits — re-reads are free)",
    "+  Context7:     $3.88    (doc lookups redirected to cached context)",
    "",
    "Tiers:",
    ">  brain:  deepseek/deepseek-chat  *",
    "-  medium: deepseek/flash",
    "-  cheap:  deepseek/chat",
    "",
    "Guards:  enforce=ON  flow=OFF  tdd=ON strict  lock=ON",
    "",
    ">~/project %",
    "",
    "-—  Quality: Brain | Provider: Deepseek | $142.30 saved | Speed | VIBE  —",
]
s2 = pad_bottom(s2)
path = render(s2, "s2_dashboard")
all_timing.append((path, 3.5))

# S3: Delegation block
s3 = [
    ">~/project % edit src/index.ts    # user tries direct write on brain tier",
    "",
    "!——————————————————————————————————————————————————————————————————————————",
    "!  🚫  BRAIN-TIER DIRECT WRITE BLOCKED",
    "!",
    "!  vibeOS delegation enforcement prevented a $0.034 API call",
    "!  to your most expensive model (deepseek/deepseek-chat at $3.00/Mtok).",
    "!",
    "!  →  Task subagent takes over on CHEAP tier (deepseek/chat at $0.14/Mtok)",
    "!  →  Same edit.  Same result.  $0.034 cheaper.  95% less.",
    "!",
    "!  Session: +$0.034  |  All-time blocks: 4,213  |  Lifetime: $142.33",
    "!——————————————————————————————————————————————————————————————————————————",
    "",
    ">~/project %",
    "",
    "# Every blocked brain-tier edit saves ~$0.034.",
    "# 4,213 blocks later = $142.30 in YOUR pocket.  Not OpenAI's.",
    "# Automatic.  Transparent.  Zero effort.  That's vibeOS.",
    "",
    "-—  Quality: Brain | Provider: Deepseek | $142.33 saved | Speed | VIBE  —",
]
s3 = pad_bottom(s3)
path = render(s3, "s3_block")
all_timing.append((path, 4.0))

# S4: Zoom on savings (full-screen data display)
s4 = [
    "",
    "",
    "@    THE NUMBERS —  ZOOM",
    "",
    "+    $0.034   —  saved every time a brain-tier edit is blocked",
    "+    4,213    —  total edits delegated since install",
    "+    $112.90  —  delegation savings:  high-cost brain → low-cost cheap",
    "+    $25.52   —  cache savings:  every repeated file read is FREE",
    "+    $3.88    —  Context7 savings:  docs already cached, never re-fetched",
    "",
    "=    $142.30  —  TOTAL SAVED.  REAL MONEY.  ZERO EFFORT.",
    "",
    "#    Without vibeOS:  estimated $480+ in raw API costs.",
    "#    With vibeOS:     $142.30.  That's a 70% reduction.",
    "#    Every turn.  Every session.  Every project.  Automatic.",
    "",
    "",
]
s4 = pad_bottom(s4)
path = render(s4, "s4_zoom")
all_timing.append((path, 3.0))

# S5: Modes (fast)
s5 = [
    ">~/project % trinity mode quality",
    "+  Mode → quality  (enforce=strict, flow=strict, TDD=quality, tier=brain)",
    "",
    ">~/project % trinity mode speed",
    "+  Mode → speed  (enforce=relaxed, flow=audit, TDD=lazy, tier=medium)",
    "",
    ">~/project % trinity mode budget",
    "+  Mode → budget  (enforce=relaxed, flow=audit, TDD=lazy, tier=cheap)",
    "",
    "=  One word.  3 characters.  Entire savings profile changes instantly.",
    "",
    "=     quality   —  ship with confidence, full reasoning",
    "=     speed     —  iterate fast, relaxed enforcement",
    "=     budget    —  maximum savings, minimum cost",
    "=     auto      —  let vibeOS decide based on stress + regime",
    "",
]
s5 = pad_bottom(s5)
path = render(s5, "s5_modes")
all_timing.append((path, 3.0))

# S6: Cache + delegation cost demo
s6 = [
    ">~/project % # vibeOS smart cache kicks in on repeated lookups...",
    "",
    "Scratchpad cache HIT:  README.md         (+$0.003 saved)",
    "Scratchpad cache HIT:  AGENTS.md          (+$0.005 saved)",
    "Scratchpad cache HIT:  package.json       (+$0.004 saved)",
    "Scratchpad cache HIT:  tsconfig.json      (+$0.003 saved)",
    "Scratchpad cache HIT:  src/index.ts       (+$0.006 saved)",
    "",
    "*  62 entries cached  |  $25.52 lifetime cache savings",
    "",
    ">~/project % # Cost breakdown:  worker delegation vs direct brain...",
    "",
    "Task subagent (deepseek/chat):   write tests + implement feature",
    "+  $0.007  ·  3.2s  ·  $0.14/Mtok (cheap tier handles the work)",
    "Brain review (deepseek/chat):    review diff + approve",
    "+  $0.005  ·  0.8s  ·  $3.00/Mtok (brain tier only reviews)",
    "",
    "+  Total:  $0.012  —  vs $0.048 without delegation  =  4× CHEAPER",
    "",
]
s6 = pad_bottom(s6)
path = render(s6, "s6_cache")
all_timing.append((path, 3.5))

# S7: Stress pipeline
s7 = [
    ">~/project % THIS ISN'T WORKING AND I'M LOSING MY MIND",
    "",
    "#  STRESS SIGNAL DETECTED:  ▆ stressed  (1.88)",
    "#  →  Auto-escalating to QUALITY mode",
    "#  →  Switching tier:  cheap → brain  (full reasoning)",
    "#  →  Stress inoculation injected into system prompt",
    "#  →  User is frustrated.  vibeOS protects the experience.",
    "",
    "*  vibeOS reads your stress signals in every message.",
    "*  Elevates quality when you're frustrated.",
    "*  Returns to cheap when you're calm.  Saves money both ways.",
    "",
    ">~/project % #  ... solution found.  stress drops:  ▆ → ▂ calm.",
    "",
    "-—  Quality: Brain | Provider: Deepseek | $142.48 saved | Quality | VIBE  —",
]
s7 = pad_bottom(s7)
path = render(s7, "s7_stress")
all_timing.append((path, 3.0))

# S8: Footer tracking
s8 = [
    ">~/project %  #  Every assistant turn appends the live savings footer:",
    "",
    "Turn  1:  — ⚡ Quality: Brain | deepseek/chat     |  $0.00   | VIBE ⚡ —",
    "Turn  3:  — ⚡ Quality: Medium | deepseek/flash   |  $0.34   | VIBE ⚡ —",
    "Turn  7:  — ⚡ Quality: Cheap | deepseek/chat     |  $1.20   | VIBE ⚡ —",
    "Turn 12:  — ⚡ Quality: Medium | deepseek/flash   |  $18.40  | VIBE ⚡ —",
    "Turn 27:  — ⚡ Quality: Brain | deepseek/v4-pro   |  $72.30  | VIBE ⚡ —",
    "Turn 51:  — ⚡ Quality: Brain | deepseek/chat     |  $142.30 | VIBE ⚡ —",
    "",
    "=  Same project.  Same features.  $142.30 auto-saved.",
    "=  Without vibeOS:  estimated $480+ in raw API costs.",
    "=  That's 70% saved.  Automatically.",
    "",
    "#  The footer updates every single turn.  You always know:",
    "#  tier · model · savings · mode · stress · trend arrow",
    "",
    "-—  Quality: Brain | Provider: Deepseek | $142.30 saved | Quality | VIBE  —",
]
s8 = pad_bottom(s8)
path = render(s8, "s8_footer")
all_timing.append((path, 3.5))

# S9: CTA
s9 = [
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
s9 = pad_bottom(s9)
path = render(s9, "s9_cta")
all_timing.append((path, 3.0))

# Write timing file
with open(timing_path, "w") as f:
    for path, dur in all_timing:
        f.write(f"file '{path}'\n")
        f.write(f"duration {dur}\n")
    # Last frame again per concat spec
    last_path, _ = all_timing[-1]
    f.write(f"file '{last_path}'\n")

print(f"  Desktop: {len(all_timing)} frame-states written")

# ──────────────────────────────────────────────────
#  SOCIAL VERSION (1080x1920) — vertical, big text
# ──────────────────────────────────────────────────

SOC_FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 24)
SOC_BIG  = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 38)
SOC_LINE_H = 32
SOC_PAD = 20

def render_soc(name, lines):
    img = Image.new("RGB", (SW, SH), BG)
    draw = ImageDraw.Draw(img)
    y = SOC_PAD
    for line in pad_bottom(lines, 56):
        if not line:
            y += SOC_LINE_H
            continue
        color = FG; text = line
        if line.startswith(">"): color, text = GRN, line[1:]
        elif line.startswith("!"): color, text = RED, line[1:]
        elif line.startswith("="): color, text = CYN, line[1:]
        elif line.startswith("+"): color, text = GRN, line[1:]
        elif line.startswith("-"): color, text = DIM, line[1:]
        elif line.startswith("*"): color, text = YLW, line[1:]
        elif line.startswith("#"): color, text = ORG, line[1:]
        elif line.startswith("@"): color, text = WHT, line[1:]
        font = SOC_BIG if line.startswith("@") else SOC_FONT
        draw.text((SOC_PAD, y), text, fill=color, font=font)
        y += SOC_LINE_H
    path = os.path.join(OUT_DIR, name + ".png")
    img.save(path)
    return path

soc_timing = []
# Soc 1: Brand + hook
path = render_soc("soc_a", [
    "@vibeOS",
    "",
    "+The Smart Savings Layer",
    "+for OpenCode.",
    "",
    "#Save real money.",
    "#Automatically.",
    "",
    "-OpenCode plugin",
])
soc_timing.append((path, 1.5))

# Soc 2: Dashboard
path = render_soc("soc_b", [
    ">trinity status",
    "",
    "+Total:    $142.30 saved",
    "+Deleg:    $112.90  (4,213 blocks)",
    "+Cache:    $25.52   (62 entries)",
    "+Ctx7:     $3.88",
    "",
    "*Guards: enforce=ON",
    "*Stress:  ▂ calm",
])
soc_timing.append((path, 2.0))

# Soc 3: Block
path = render_soc("soc_c", [
    "!BRAIN-TIER WRITE BLOCKED",
    "",
    "#$0.034 saved this edit",
    "#4,213 edits delegated",
    "#95% cheaper routing",
    "",
    "*Same result.",
    "*Less than 1/20 the cost.",
    "",
    "=That's vibeOS.",
])
soc_timing.append((path, 2.0))

# Soc 4: Modes
path = render_soc("soc_d", [
    "=quality · speed · budget",
    "",
    "+One word.  3 letters.",
    "+Your entire profile",
    "+changes instantly.",
    "",
    "#quality:  strict enforcement",
    "#speed:    fast iteration",
    "#budget:   max savings",
    "#auto:     vibeOS decides",
])
soc_timing.append((path, 2.0))

# Soc 5: Stacked savings
path = render_soc("soc_e", [
    "",
    "",
    "@TOTAL SAVED",
    "",
    "+$142.30",
    "",
    "=Without:  $480+",
    "=With:     $142.30",
    "=Saved:    70%",
    "",
    "#Every turn. Auto.",
])
soc_timing.append((path, 2.0))

# Soc 6: CTA
path = render_soc("soc_f", [
    "",
    "",
    "@vibeOS",
    "",
    "+npm install vibeoscore",
    "-github.com/anomalyco/vibeOS",
    "",
    "#Free. Open Source.",
    "#Saves real money.",
])
soc_timing.append((path, 2.0))

# Write social timing
soc_timing_path = os.path.join(OUT_DIR, "fullscreen_social_timing.txt")
with open(soc_timing_path, "w") as f:
    for path, dur in soc_timing:
        f.write(f"file '{path}'\n")
        f.write(f"duration {dur}\n")
    last_soc, _ = soc_timing[-1]
    f.write(f"file '{last_soc}'\n")

print(f"  Social:  {len(soc_timing)} frames written")
print(f"\n  All frames in: {OUT_DIR}")
