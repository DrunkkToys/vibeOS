#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────
#  vibeOS Commercial — Terminal Recording Script
#  Record with: QuickTime → File → New Screen Recording
#  Or: shift-cmd-5 → crop to terminal window
# ─────────────────────────────────────────────

CSI=$'\033['
RESET="${CSI}0m"
BOLD="${CSI}1m"
DIM="${CSI}2m"
GREEN="${CSI}32m"
YELLOW="${CSI}33m"
CYAN="${CSI}36m"
WHITE="${CSI}37m"
RED="${CSI}91m"

PROMPT="${GREEN}~/project${RESET} ${BOLD}\$${RESET} "

type_out() { for ((i=0; i<${#1}; i++)); do printf '%s' "${1:$i:1}"; sleep 0.04; done; }
fake_footer() {
  local tier="${1:-Brain}" provider="${2:-Deepseek}" model="${3:-deepseek/deepseek-chat}" saved="${4:-50.71}" mode="${5}"
  local mode_str=""
  [[ -n "$mode" ]] && mode_str=" | ${mode}"
  printf '\n\n%s Quality: %s | Provider: %s | Model: %s | $%s saved%s | VIBE ⚡ %s\n' \
    "— ⚡" "$tier" "$provider" "$model" "$saved" "$mode_str" "—"
}

clear
echo

# ─── SCENE 1: HOOK ───────────────────────────
echo "${DIM}┌─────────────────────────────────────────────────┐${RESET}"
echo "${DIM}│${RESET}  ${BOLD}${RED}AI coding costs bleeding your wallet?${RESET}        ${DIM}│${RESET}"
echo "${DIM}│${RESET}  ${BOLD}vibeOS — the smart savings layer for OpenCode${RESET}  ${DIM}│${RESET}"
echo "${DIM}└─────────────────────────────────────────────────┘${RESET}"
sleep 3
clear

# ─── SCENE 2: TRINITY STATUS ─────────────────
printf '%s' "$PROMPT"
type_out "trinity status"
sleep 1.2
echo
sleep 0.3

echo "${BOLD}[vibeOS-dashboard]${RESET}"
sleep 0.2
echo "Model: ${GREEN}brain${RESET} (deepseek/deepseek-chat)"
sleep 0.15
echo "Provider: Deepseek"
sleep 0.15
echo "Quality: Brain"
sleep 0.15
echo "Split: brain 70% / worker 30% (42 total)"
sleep 0.15
echo "Credit: 85%  |  Quality: 92%"
sleep 0.15
echo "Decision: CLOSED_GOOD  CLOSED  ${GREEN}↑ up${RESET}"
sleep 0.2
echo "Stress: ▂ (${GREEN}calm${RESET})"
sleep 0.2
echo
sleep 0.15
echo "Guards:"
sleep 0.15
echo "  Flow:   OFF"
sleep 0.15
echo "  TDD:    ON strict quality"
sleep 0.15
echo "  Enforce: ON (mandatory)"
sleep 0.15
echo "  Lock:   🔒 ON (brain) deepseek/deepseek-chat"
sleep 0.2
echo
sleep 0.15
echo "All-time savings:"
sleep 0.15
echo "  Total:       ${GREEN}\$138.42${RESET} (${GREEN}↑ up${RESET})"
sleep 0.15
echo "  Delegation:  \$112.90"
sleep 0.15
echo "  Cache:       \$25.52"
sleep 0.2
echo
sleep 0.15
echo "Tiers:"
sleep 0.1
echo "  brain:  deepseek/deepseek-chat  ${GREEN}*${RESET}"
sleep 0.1
echo "  medium: deepseek/deepseek-v4-flash"
sleep 0.1
echo "  cheap:  deepseek/deepseek-chat"
sleep 2

# ─── SCENE 3: MODE SWITCH ─────────────────────
printf '\n%s' "$PROMPT"
type_out "trinity mode quality"
sleep 0.6
echo
sleep 0.3
echo "✅ Mode → ${BOLD}quality${RESET} (enforce=strict, flow=strict, TDD=quality, tier=brain)"
sleep 1.5

# ─── SCENE 4: DELEGATION ENFORCEMENT ──────────
printf '\n%s' "$PROMPT"
echo -n "${DIM}edit src/index.ts  # oops...${RESET}"
sleep 1.5
echo
sleep 0.3
echo
echo "${RED}🚫 [vibeOS] Brain tier direct write blocked${RESET} → delegate via Task or run \`trinity medium\`."
sleep 0.5
echo "${YELLOW}   Saves ~\$0.034 per edit by routing to cheap worker.${RESET}"
sleep 2

# ─── SCENE 5: SWITCH TIERS ────────────────────
printf '\n%s' "$PROMPT"
type_out "trinity set medium"
sleep 0.6
echo
sleep 0.3
echo "✅ Slot switched → ${YELLOW}medium${RESET} (deepseek/deepseek-v4-flash)"
sleep 0.5
fake_footer "Medium" "Deepseek" "deepseek/deepseek-v4-flash" "138.46" "quality"
sleep 2

# ─── SCENE 6: FLOW + TDD ─────────────────────
printf '\n%s' "$PROMPT"
type_out "trinity flow on"
sleep 0.5
echo
sleep 0.2
echo "✅ Flow enforcer → ON (audit mode)"
sleep 0.3

printf '%s' "$PROMPT"
type_out "trinity tdd strict off"
sleep 0.5
echo
sleep 0.2
echo "✅ TDD strict → OFF (quality mode remains)"
sleep 1.5

# ─── SCENE 7: SPEED MODE ─────────────────────
printf '\n%s' "$PROMPT"
type_out "trinity mode speed"
sleep 0.5
echo
sleep 0.2
echo "✅ Mode → ${BOLD}speed${RESET} (enforce=relaxed, flow=audit, TDD=lazy, tier=medium)"
sleep 0.5
fake_footer "Medium" "Deepseek" "deepseek/deepseek-v4-flash" "138.52" "speed"
sleep 2

# ─── SCENE 8: STRESS GAUGE ───────────────────
printf '\n%s' "$PROMPT"
echo -n "${DIM}# User types frustrated message...${RESET}"
sleep 2
echo
sleep 0.5
fake_footer "Medium" "Deepseek" "deepseek/deepseek-v4-flash" "138.58" "speed"
echo "Stress: ${YELLOW}▅${RESET} (${YELLOW}elevated${RESET}) — auto-escalating to quality mode..."
sleep 2

# ─── SCENE 9: CLOSING ────────────────────────
clear
echo
echo "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${CYAN}║${RESET}                                                  ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}   vibeOS — Code smart. Save automatically.       ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}                                                  ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}   ${DIM}npm install vibeoscore${RESET}                            ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}   ${DIM}github.com/anomalyco/vibeOS${RESET}                     ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}                                                  ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}   ${GREEN}▶  Free. Open Source. Saves real money.${RESET}         ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}║${RESET}                                                  ${BOLD}${CYAN}║${RESET}"
echo "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}"
echo
sleep 4
