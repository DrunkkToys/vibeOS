---
name: vibeOS-core
description: Use when the user mentions "vibeOS", "trinity", "model slot", "delegation enforcement", "savings", or "footer". Covers core plugin commands: trinity set/status/enable/disable, model switching, enforcement toggles, flow/TDD basics, and install instructions. Does NOT cover blackbox engine, pattern learner, or stress pipeline (see vibeOS-advanced).
---

# vibeOS Core

vibeOS is a cost-aware delegation and policy plugin for OpenCode. It tracks savings, enforces delegation rules on expensive models, and provides real-time runtime controls.

## Install

npm: `npm install vibeOS`

Then add to `~/.config/opencode/opencode.json`:
```json
"plugins": [{"id": "vibeOS", "path": "vibeOS"}]
```

Restart OpenCode.

## Trinity Commands

| Command | Effect |
|---|---|
| `trinity status` | Show current state (model slot, enforcement, flow, TDD, blackbox) |
| `trinity set brain|medium|cheap` | Switch model slot |
| `trinity brain|medium|cheap` | Shorthand slot switch |
| `trinity rebuild` | Auto-detect available models and re-populate slots |
| `trinity enable` / `trinity disable` | Enable or disable the plugin |
| `trinity lock on|off` | Prevent auto-switching model when user changes it in GUI (in-memory, resets on restart) |
| `trinity report savings` | Show delegation and cache savings report |

## Enforcement

| Command | Effect |
|---|---|
| `trinity enforce on|off` | Toggle delegation enforcement |
| `trinity flow on|off` | Toggle flow enforcer (write/edit pattern checks) |
| `trinity flow enforce on|off` | Toggle strict flow enforcement |
| `trinity tdd on|off` | Toggle auto-test skeleton generation |
| `trinity tdd strict on|off` | Toggle strict TDD mode |
| `trinity tdd quality on|off` | Toggle TDD quality checks |

## Thinking Mode

`trinity thinking full|brief|off` — set reasoning depth.

## Reports

- `report-save` — save session findings
- `report-list` — list saved reports
- `report-read` — read a report by ID
- `research-audit` — scan for research anti-patterns

## Footers

Footer shows route, savings, stress gauge, and enforcement status. Example:
`— [deepseek-chat] [AUTO→BALANCED] [ENF ON] [TDD ON] | vibeOS: $0.61 saved → | stress: ▁ calm —`

## Mode Commands

`trinity mode budget|quality|speed|longrun|auto` — override optimization mode.
