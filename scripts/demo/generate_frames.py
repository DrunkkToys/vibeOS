#!/usr/bin/env python3
"""Generate vibeOS commercial frames as PNG images."""

import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "output", "frames")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (10, 10, 16)
FG = (224, 224, 224)
GREEN = (0, 221, 102)
CYAN = (0, 204, 255)
YELLOW = (255, 170, 0)
RED = (255, 68, 68)
DIM = (102, 102, 136)
HEADER = (255, 255, 255)
ORANGE = (255, 136, 0)

FONT_BOLD = None
FONT_REG = None
FONT_SMALL = None

def load_fonts():
    global FONT_BOLD, FONT_REG, FONT_SMALL
    font_paths = [
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/SFN-Mono.ttc",
        "/System/Library/Fonts/Courier.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                FONT_REG = ImageFont.truetype(fp, 26)
                FONT_BOLD = ImageFont.truetype(fp, 36)
                FONT_SMALL = ImageFont.truetype(fp, 20)
                return
            except:
                continue
    FONT_REG = ImageFont.load_default()
    FONT_BOLD = ImageFont.load_default()
    FONT_SMALL = ImageFont.load_default()

def make_frame(width, height, lines, name, bg=BG):
    """Create a single frame with lines of text."""
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    y = 80
    for line in lines:
        color = FG
        font = FONT_REG
        prefix = ""
        if line.startswith("PROMPT:"):
            color, font, prefix = GREEN, FONT_SMALL, "PROMPT:"
        elif line.startswith("HEADER:"):
            color, font, prefix = HEADER, FONT_BOLD, "HEADER:"
        elif line.startswith("GREEN:"):
            color, prefix = GREEN, "GREEN:"
        elif line.startswith("CYAN:"):
            color, prefix = CYAN, "CYAN:"
        elif line.startswith("YELLOW:"):
            color, prefix = YELLOW, "YELLOW:"
        elif line.startswith("RED:"):
            color, prefix = RED, "RED:"
        elif line.startswith("DIM:"):
            color, font, prefix = DIM, FONT_SMALL, "DIM:"
        elif line.startswith("BIG:"):
            color, font, prefix = HEADER, FONT_BOLD, "BIG:"
        elif line.startswith("MED:"):
            color, prefix = FG, "MED:"
        elif line.startswith("ORANGE:"):
            color, prefix = ORANGE, "ORANGE:"
        text = line[len(prefix):] if prefix else line
        draw.text((60, y), text, fill=color, font=font)
        y += 38
    path = os.path.join(OUT_DIR, f"{name}.png")
    img.save(path)
    return path

def main():
    load_fonts()
    W, H = 1920, 1080

    scenes = [
        ("s0_intro", [
            "BIG:vibeOS",
            "MED:",
            "MED:the smart savings layer for OpenCode",
            "DIM:",
            "DIM:save money while you code. automatically.",
        ]),
        ("s1_problem", [
            "HEADER:AI coding costs -- the truth",
            "CYAN:",
            "CYAN:  deepseek-v4-pro     $3.00/Mtok input",
            "CYAN:  deepseek-chat       $0.14/Mtok output",
            "CYAN:",
            "YELLOW:  Brain-tier burns cash on every single edit.",
            "YELLOW:  90% of edits don't need $3/Mtok reasoning.",
            "GREEN:  vibeOS auto-routes work to the cheapest capable model.",
        ]),
        ("s2_dashboard", [
            "PROMPT:$ trinity status",
            "HEADER:[vibeOS-dashboard]",
            "GREEN:Model:        brain  (deepseek/deepseek-chat)",
            "CYAN:Quality:       Brain    Guard:  ACTIVE",
            "YELLOW:Split:        70% brain / 30% worker  (51 tasks total)",
            "GREEN:Decision:      CLOSED_GOOD    ↑ momentum up",
            "DIM:Savings:       $138.42 total  |  $112.90 delegation  |  $25.52 cache",
            "YELLOW:",
            "YELLOW:Guards:  enforce=ON  flow=OFF  tdd=ON  lock=ON",
        ]),
        ("s3_delegate", [
            "PROMPT:$ edit src/index.ts",
            "RED:",
            "RED:  Brain-tier direct write BLOCKED",
            "YELLOW:",
            "YELLOW:  ->  Delegate via Task subagent (cheap tier)",
            "YELLOW:  ->  or run 'trinity set medium' to unlock",
            "YELLOW:",
            "GREEN:  Saves ~$0.034 per edit   --   $138.42 lifetime",
            "GREEN:  Your most expensive model handles logic only.",
            "DIM:     Worker tasks run on deepseek-chat ($0.14/Mtok)",
        ]),
        ("s4_modes", [
            "PROMPT:$ trinity mode quality",
            "GREEN:  Mode -> quality  (enforce=strict, flow=strict, TDD=quality)",
            "CYAN:",
            "PROMPT:$ trinity mode speed",
            "GREEN:  Mode -> speed  (enforce=relaxed, flow=audit, TDD=lazy)",
            "YELLOW:",
            "PROMPT:$ trinity mode budget",
            "GREEN:  Mode -> budget  (cheap tier, minimal reasoning overhead)",
            "CYAN:",
            "HEADER:  quality   speed   budget   auto",
            "DIM:    One command. Instant savings profile switch.",
        ]),
        ("s5_stress", [
            "HEADER:Stress Pipeline  --  your frustration detector",
            "CYAN:",
            "MED:       -- live stress gauge in your footer",
            "ORANGE:      calm    elevated    stressed    critical",
            "YELLOW:",
            "YELLOW:  Stress > 1.5  ->  auto-escalates to quality mode",
            "YELLOW:  Frustrated user? vibeOS protects your wallet.",
            "CYAN:",
            "DIM:  Detects urgency signals in user messages.",
            "DIM:  Routes to appropriate tier automatically.",
        ]),
        ("s6_flowtdd", [
            "PROMPT:$ trinity flow on",
            "GREEN:  Flow enforcer -> ON  (audit mode)",
            "CYAN:",
            "PROMPT:$ trinity tdd strict on",
            "GREEN:  TDD strict -> ON  (TODO tests fail loudly)",
            "YELLOW:",
            "HEADER:Write safer code, automatically.",
            "DIM:  Flow enforcer checks edit patterns + extracts TODOs.",
            "DIM:  TDD enforcer generates test skeletons on file changes.",
        ]),
        ("s7_footer", [
            "HEADER:Live Footer  --  always visible, always saving",
            "CYAN:",
            "GREEN:  Quality: Brain | Provider: Deepseek | Model: deepseek-chat",
            "GREEN:  $142.30 saved | Speed | VIBE",
            "CYAN:",
            "DIM:  Model split   Cumulative savings   Trend arrow",
            "DIM:  Stress gauge   Lock state   Mode badge",
            "YELLOW:",
            "YELLOW:  Every message. Every turn. You see the savings.",
        ]),
        ("s8_cta", [
            "BIG:vibeOS",
            "MED:",
            "MED:Free. Open Source. Saves real money.",
            "GREEN:",
            "CYAN:  npm install vibeoscore",
            "DIM:  github.com/anomalyco/vibeOS",
            "DIM:",
            "DIM:",
            "YELLOW:  Code smart. Save automatically.",
        ]),
    ]

    # Desktop frames
    paths = []
    for name, lines in scenes:
        p = make_frame(W, H, lines, f"desktop_{name}")
        paths.append(p)
        print(f"  {p}")

    # Social frames (vertical)
    SW, SH = 1080, 1920
    social_scenes = [
        ("ss0", [
            "BIG:vibeOS",
            "MED:",
            "MED:Save money",
            "MED:while you code",
            "DIM:",
            "DIM:OpenCode plugin",
        ]),
        ("ss1", [
            "HEADER:AI is expensive",
            "CYAN:",
            "CYAN:Brain: $3.00/Mtok",
            "CYAN:Worker: $0.14/Mtok",
            "YELLOW:",
            "YELLOW:vibeOS auto-routes",
            "YELLOW:to cheapest capable",
            "YELLOW:model -- every turn.",
        ]),
        ("ss2", [
            "HEADER:trinity status",
            "GREEN:Full savings dashboard",
            "CYAN:Live model split display",
            "YELLOW:Cumulative $ saved",
            "DIM:",
            "DIM:Delegation enforcement",
        ]),
        ("ss3", [
            "HEADER:Delegation",
            "RED:Brain write BLOCKED",
            "YELLOW:Workers handle edits",
            "GREEN:Saves $0.034 per edit",
            "DIM:",
            "DIM:Lifetime: $138.42 saved",
        ]),
        ("ss4", [
            "HEADER:trinity mode",
            "GREEN:quality",
            "GREEN:speed",
            "GREEN:budget",
            "CYAN:",
            "CYAN:One word changes",
            "CYAN:your entire profile.",
        ]),
        ("ss5", [
            "HEADER:Stress Pipeline",
            "MED:calm  elevated",
            "MED:stressed  critical",
            "YELLOW:Frustrated?",
            "YELLOW:vibeOS escalates",
            "YELLOW:to protect you.",
        ]),
        ("ss6", [
            "BIG:vibeOS",
            "MED:Free. Open Source.",
            "GREEN:",
            "CYAN:npm install vibeoscore",
            "DIM:github.com/anomalyco/vibeOS",
        ]),
    ]
    for name, lines in social_scenes:
        p = make_frame(SW, SH, lines, f"social_{name}")
        paths.append(p)
        print(f"  {p}")

    print(f"\nAll {len(paths)} frames generated in {OUT_DIR}")

if __name__ == "__main__":
    main()
