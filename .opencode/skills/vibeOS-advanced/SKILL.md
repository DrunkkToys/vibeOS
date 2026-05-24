---
name: vibeOS-advanced
description: Use when the user mentions blackbox, stress gauge, pattern learner, diagnose, project guard, repair-state, patterns, stress pipeline, auto-mode, or project skill generation. Requires vibeOS-core.
---

# vibeOS Advanced

## Blackbox Decision Engine

The blackbox engine tracks dialogue trajectory per session with 7 sub-regimes, loop prevention, pivot/switch detection, and outcome tracking. State is persisted per project in `~/.claude/blackbox-state.json` and calibrated from session outcomes.

| Command | Effect |
|---|---|
| `trinity blackbox on` | Enable the decision engine |
| `trinity blackbox off` | Disable it |
| `trinity blackbox status` | Show resolution state, momentum, and project history |
| `trinity blackbox reset` | Clear tracker state for the current session |

## Auto-Mode

Auto-mode is regime and stress driven:

- `LOOPING` → `speed`
- `CONVERGING` or `CLOSED` → `quality`
- stress above `1.5` → `quality`
- otherwise → `budget`

The control vector is written into `model-tiers.json` each turn so enforcement, flow, TDD, and thinking mode stay synchronized with the current session state.

When blackbox is disabled, `classifyTurnSimple()` falls back to a lighter Q&A vs implementation split.

## Pattern Learning

The pattern learner tracks recurring friction and routine patterns per project.

| Command | Effect |
|---|---|
| `trinity patterns` | Show learned patterns |
| `trinity patterns clear` | Clear learned patterns for the current project |
| `trinity patterns suggest` | Suggest patterns from similar stack projects |

When enough patterns are promoted, vibeOS can generate a project skill under `.opencode/skills/<project>/SKILL.md`.

## Stress Mitigation

Stress signals in the user message can raise the routing tier and change the tone of the system prompt. The footer also surfaces a live stress gauge so the session stays readable at a glance.

## Project Guard

`trinity guard` refreshes the project-level `AGENTS.md` and `README.md` guidance so the workspace docs stay aligned with the current command surface.

## Remote API

The protected algorithms still resolve through `api.vibetheog.com` when the token is available. If the API is suspended or unavailable, vibeOS falls back to local degraded mode.

## Diagnostics

- `trinity diagnose` runs a runtime health check
- `trinity repair-state preview|apply` fixes fingerprint collisions before they spread

## Session Workflow

| Regime | Mode | Enforce | Flow | TDD | Think | Tier |
|---|---|---|---|---|---|---|
| INIT / EXPLORING / DIVERGENT | budget | relaxed | audit | lazy | off | cheap |
| REFINING | budget | relaxed | audit | lazy | off | cheap |
| CONVERGING / CLOSED | quality | strict | strict | quality | full | brain |
| LOOPING | speed | relaxed | audit | lazy | brief | medium |

Stress above `1.5` escalates any regime to quality mode.
