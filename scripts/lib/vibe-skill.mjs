import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

export const VIBE_SKILL_BODY = `---
name: vibe
description: Use for all vibeOS work: /vibe, trinity controls, model slots, delegation enforcement, cascade routing, savings, footer, MCP, dashboard, API token setup, reports, diagnostics, blackbox, stress, pattern learning, project guard, and repair-state.
---

# vibeOS

Use this as the only vibeOS skill. It covers the command surface, runtime controls, routing, diagnostics, and project memory.

## Route quickly

- \`vibe status\` for the one-line system summary
- \`vibe dashboard\` for the live dashboard URL and browser view
- \`vibe help\` when the user wants the available command surface
- \`vibe diagnose\` for runtime health
- \`vibe repair-state preview|apply\` before touching persistent state

## Runtime controls

| Command | Effect |
|---|---|
| \`vibe status\` | Show current state, savings, stress, and lock state |
| \`vibe set brain|medium|cheap\` | Switch the active model slot |
| \`trinity brain|medium|cheap\` | Shorthand slot switch |
| \`vibe rebuild\` | Re-detect models and repopulate slots |
| \`vibe mode budget|quality|speed|longrun|auto|balanced|audit|vibeultrax|vibeqmax|vibemax|forensic\` | Change optimization mode |
| \`vibe thinking full|brief|off\` | Set reasoning depth |
| \`vibe enforce on|off\` | Toggle delegation enforcement |
| \`vibe lock on|off\` | Freeze the active model for the session |
| \`vibe flow on|off\` | Toggle flow checks |
| \`vibe flow enforce on|off\` | Toggle TODO extraction |
| \`vibe tdd on|off\` | Toggle auto test skeletons |
| \`vibe tdd strict on|off\` | Toggle strict TDD |
| \`vibe tdd quality on|off\` | Toggle quality TDD |
| \`vibe project\` | Show project analytics |
| \`vibe patterns\` / \`vibe patterns clear\` | Inspect or clear learned patterns |
| \`vibe blackbox on|off|status|reset\` | Control the blackbox engine |
| \`vibe api-token <token>\` | Update the remote API token |
| \`vibe report-save|report-list|report-read\` | Manage reports |
| \`vibe research-audit\` | Run research audit tooling |

## Routing and enforcement

vibeOS keeps orchestration on the strong tier, routes implementation through cheaper Task workers when appropriate, tracks savings, and surfaces state in the footer and dashboard.

VibeUltraX uses a cheap -> medium -> brain cascade. Complex prompts may select a brain acting tier while preserving cheap as the root entry slot.

Delegation enforcement can block direct write/edit tools on high-tier models. Prefer Task delegation when enforcement is active.

## Advanced state

Blackbox tracks sub-regimes, loop prevention, pivot detection, outcome signals, and stress. Auto-mode writes enforcement, flow, TDD, thinking, and slot choices to \`model-tiers.json\`.

Pattern learning records recurring friction and routines per project. Project Guard refreshes project-level guidance and can generate project-specific skills only when patterns are promoted.

## State files

- \`~/.claude/model-tiers.json\`
- \`~/.claude/delegation-state.json\`
- \`~/.claude/project-states.json\`
- \`~/.claude/blackbox-state.json\`
- \`~/.claude/savings-ledger.jsonl\`
- \`~/.claude/reports/\`
- \`~/.claude/.flow-todo-queue.jsonl\`
- \`~/.claude/.enforcement-cooldown.jsonl\`

## Working rules

- Keep the implementation device-agnostic so it works for every user who installs the plugin.
- Prefer the built-in \`vibe\` and \`trinity\` command surface over shell workarounds.
- Treat the dashboard as the canonical UI for session-level control when the user asks for a visual view.
- Never manually edit or delete persistent state while the plugin is running.
- Do not create additional generic vibeOS skills. \`vibe\` is the single global skill.
`

export function installVibeSkill(targetRoot) {
  const root = String(targetRoot || "").trim()
  if (!root) return { created: false, skipped: false }
  const skillPath = join(resolveSkillRoot(root), "skills", "vibe", "SKILL.md")
  const existing = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : ""
  if (existing === VIBE_SKILL_BODY) {
    return { created: false, skipped: true, path: skillPath }
  }
  mkdirSync(dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, VIBE_SKILL_BODY, "utf8")
  return { created: true, skipped: false, path: skillPath }
}

function resolveSkillRoot(root) {
  return basename(root) === ".opencode" ? root : join(root, ".opencode")
}
