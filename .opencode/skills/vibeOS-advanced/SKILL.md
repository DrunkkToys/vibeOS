---
name: vibeOS-advanced
description: Use when the user mentions "blackbox", "stress gauge", "pattern learner", "diagnose", "project guard", "repair state", "patterns", "suggest patterns", or "stress pipeline". Covers blackbox decision engine, pattern learning, stress mitigation, project guard, and calibration. Requires vibeOS-core to be installed.
---

# vibeOS Advanced

## Blackbox Decision Engine

Tracks dialogue trajectory per session with 7 sub-regimes (INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING), 11 derived features per turn, loop prevention with 4 escalating intervention levels, and pivot/switch detection for context changes.

| Command | Effect |
|---|---|
| `trinity blackbox on` | Enable decision engine |
| `trinity blackbox off` | Disable |
| `trinity blackbox status` | Show resolution state, sub-regime, momentum, loop state |
| `trinity blackbox reset` | Clear tracker for current session |

When disabled, a lightweight fallback (`classifyTurnSimple()`) detects Q&A vs implementation intent.

## Pattern Learning

Learns recurring struggle/routine patterns per project.

| Command | Effect |
|---|---|
| `trinity patterns` | Show learned patterns |
| `trinity patterns clear` | Clear all learned patterns |
| `trinity patterns suggest` | Suggest optimizations based on patterns (help text only; no handler) |

Stored in `~/.claude/project-states.json`. Patterns are promoted after repeated confirmation across sessions.

## Stress Mitigation Pipeline

Detects stress signals from user messages and responds:

- Live stress gauge in footer: `▁▂▃▅▆█` (calm to high)
- System prompt inoculation at critical/elevated levels
- Stress-aware tier routing: upgrades Task to MEDIUM when stressed

Check current stress via `trinity status`.

## Project Guard

Auto-creates and protects `AGENTS.md` and `README.md` in every project.

`trinity guard` — regenerate both files on demand.

## Diagnostics

`trinity diagnose` — run full diagnostics on plugin state, connections, and API availability.

`trinity repair-state` — attempt to repair corrupted state files.

## Session Workflow

The meta-controller auto-toggles enforcement/flow/TDD/thinking per regime:

| Regime | Mode | Enforce | Flow | TDD | Think | Tier |
|---|---|---|---|---|---|---|---|
| INIT / EXPLORING / DIVERGENT | budget | relaxed | audit | lazy | off | cheap |
| REFINING | budget | relaxed | audit | lazy | off | cheap |
| CONVERGING / CLOSED | quality | strict | strict | quality | on | brain |
| LOOPING | speed | relaxed | audit | lazy | brief | medium |

Stress > 1.5 escalates any regime to quality mode (tightens enforcement, activates brain tier). Manual `trinity enforce on|off` overrides are temporary — next turn re-evaluates.
