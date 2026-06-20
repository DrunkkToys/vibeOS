---
name: vibe
description: Use when the user asks for the primary vibeOS entrypoint, says /vibe, wants a fast dashboard/status check, or wants to control sessions, templates, model slots, TDD, flow, blackbox, reports, or diagnostics through vibeOS.
---

# /vibe

Use this as the default workspace command for vibeOS.

## Route quickly

- `vibe status` for the one-line system summary
- `vibe dashboard` for the live dashboard URL and browser view
- `vibe help` when the user wants the available command surface

## What belongs here

- Session orchestration and session templates
- Model slots, mode, lock, enforcement, flow, and TDD controls
- Blackbox, patterns, reports, and diagnostics
- Remote API-backed features when available

## Working rules

- Keep the implementation device-agnostic so it works for every user who installs the plugin.
- Prefer the built-in `vibe` and `trinity` command surface over shell workarounds.
- Treat the dashboard as the canonical UI for session-level control when the user asks for a visual view.
