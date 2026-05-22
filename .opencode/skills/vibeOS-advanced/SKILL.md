---
name: vibeOS-advanced
description: Use when the user mentions "blackbox", "stress gauge", "pattern learner", "diagnose", "project guard", "repair state", "patterns", "suggest patterns", "stress pipeline", "control vector", "auto-mode", or "project skill". Covers blackbox decision engine, pattern learning, stress mitigation, project guard, calibration, auto-mode, and control vector sync. Requires vibeOS-core to be installed.
---

# vibeOS Advanced

## Blackbox Decision Engine

Tracks dialogue trajectory per session with 7 sub-regimes (INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING), 11 derived features per turn, loop prevention with 4 escalating intervention levels, pivot/switch detection for context changes, and online calibration via remote API. State persisted per project in `~/.claude/blackbox-state.json`.

| Command | Effect |
|---|---|
| `trinity blackbox on` | Enable decision engine |
| `trinity blackbox off` | Disable |
| `trinity blackbox status` | Show resolution state, sub-regime, momentum, loop state |
| `trinity blackbox reset` | Clear tracker for current session |

### Auto-Mode

When blackbox is enabled and optimization mode is `auto`, the control vector drives all enforcement settings every turn via `syncControlSettings()`:
- Mode selection: CONVERGING/CLOSED → quality, LOOPING → speed, stress >1.5 → quality, else budget
- Writes enforcement, flow, TDD, thinking to `model-tiers.json` per turn
- No savings goal threshold — purely regime + stress driven

When disabled, a lightweight fallback (`classifyTurnSimple()`) detects Q&A vs implementation intent.

### Context Budget Warning

Injects system prompt directive when context window exceeds 70% full (WARNING) or 90% (CRITICAL), advising Task subagent usage, output compression, or new session.

## Pattern Learning

Learns recurring struggle/routine patterns per project. Auto-generates project skills (`ensureProjectSkill()`) when 3+ promoted patterns exist.

| Command | Effect |
|---|---|
| `trinity patterns` | Show learned patterns |
| `trinity patterns clear` | Clear all learned patterns |
| `trinity patterns suggest` | Suggest patterns from similar tech stack projects |

Stored in `~/.claude/project-states.json`. Patterns are promoted after repeated confirmation across sessions.

## Stress Mitigation Pipeline

Detects stress signals from user messages and responds:

- Live stress gauge in footer: `down-tick up-tick down-tick-dbl down-tick-tri up-tick full` (calm to high)
- System prompt inoculation at critical/elevated levels (structured markdown, code blocks, thorough responses)
- Stress-aware tier routing: upgrades Task to MEDIUM when stressed

Check current stress via `trinity status`.

## Project Guard

Auto-creates and protects `AGENTS.md` and `README.md` in every project.

`trinity guard` — regenerate both files on demand.

Also auto-generates `.opencode/skills/<project>/SKILL.md` from promoted patterns via `ensureProjectSkill()`.

## Remote API

`trinity api-token <token>` — update API token at runtime to re-enable remote control-vector computation.

Core algorithms served from `api.vibetheog.com` (Fastify + SQLite). Token-based auth with seat/license management. Suspended seats revoke all tokens immediately; plugin falls back to local degraded mode.

## Diagnostics

`trinity diagnose` — run full diagnostics on plugin state, connections, model probes, and API availability.

`trinity repair-state preview|apply` — fix fingerprint collisions between project state hashes (creates backups before applying).

## Session Workflow

The meta-controller auto-toggles enforcement/flow/TDD/thinking per regime via control vector:

| Regime | Mode | Enforce | Flow | TDD | Think | Tier |
|---|---|---|---|---|---|---|
| INIT / EXPLORING / DIVERGENT | budget | relaxed | audit | lazy | off | cheap |
| REFINING | budget | relaxed | audit | lazy | off | cheap |
| CONVERGING / CLOSED | quality | strict | strict | quality | on | brain |
| LOOPING | speed | relaxed | audit | lazy | brief | medium |

Stress > 1.5 escalates any regime to quality mode (tightens enforcement, activates brain tier). Manual `trinity enforce on|off` overrides are temporary — next turn re-evaluates via `syncControlSettings()`.
