import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const VIBE_SKILL_BODY = `---
name: vibe
description: Use when the user asks for the primary vibeOS entrypoint, says /vibe, wants a fast dashboard/status check, or wants to control sessions, templates, model slots, TDD, flow, blackbox, reports, or diagnostics through vibeOS.
---

# /vibe

Use this as the default workspace command for vibeOS.

## Route quickly

- \`vibe status\` for the one-line system summary
- \`vibe dashboard\` for the live dashboard URL and browser view
- \`vibe help\` when the user wants the available command surface

## What belongs here

- Session orchestration and session templates
- Model slots, mode, lock, enforcement, flow, and TDD controls
- Blackbox, patterns, reports, and diagnostics
- Remote API-backed features when available

## Working rules

- Keep the implementation device-agnostic so it works for every user who installs the plugin.
- Prefer the built-in \`vibe\` and \`trinity\` command surface over shell workarounds.
- Treat the dashboard as the canonical UI for session-level control when the user asks for a visual view.
`

export function installVibeSkill(targetRoot) {
  const root = String(targetRoot || "").trim()
  if (!root) return { created: false, skipped: false }
  const skillPath = join(root, ".opencode", "skills", "vibe", "SKILL.md")
  const existing = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : ""
  if (existing === VIBE_SKILL_BODY) {
    return { created: false, skipped: true, path: skillPath }
  }
  mkdirSync(dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, VIBE_SKILL_BODY, "utf8")
  return { created: true, skipped: false, path: skillPath }
}
