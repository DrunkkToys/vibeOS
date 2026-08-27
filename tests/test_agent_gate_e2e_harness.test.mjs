// SPDX-License-Identifier: MIT
// Contract: the live harnesses must drive an agent vibeOS actually runs under.
//
// vibeOS gates every automatic hook on the session agent being `vibe` or a vibe-*
// tier subagent (src/lib/agent-gate.ts). Both live harnesses hardcoded
// `--agent build`, so they registered the plugin and then skipped every hook —
// no footer, no system directives, no enforcement, and no chat.params model
// override, which IS the ML routing. Every assertion they made was against an
// inert plugin.
//
// Confirmed live before this guard existed: one real `opencode run` per agent,
// isolated VIBEOS_HOME, identical prompt —
//   --agent build : 0 cascade-audit rows, 0 chat-params rows, no footer
//   --agent vibe  : 3 cascade-audit rows, 1 chat-params row, footer present

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const HARNESSES = ["scripts/e2e/harness.mjs", "scripts/e2e/impact.mjs"]

const { isVibeAgentName } = await import("../src/lib/agent-gate.js")
const { installVibeTierAgentsInConfig } = await import("../scripts/lib/vibe-tier-agents.mjs")

for (const rel of HARNESSES) {
  const src = readFileSync(join(ROOT, rel), "utf8")

  test(`${rel} does not drive a non-vibe agent`, () => {
    assert.equal(
      /"--agent",\s*"build"/.test(src), false,
      `${rel} hardcodes --agent build; vibeOS skips every hook under it`,
    )
    assert.equal(
      /"--agent",\s*"plan"/.test(src), false,
      `${rel} hardcodes --agent plan; vibeOS skips every hook under it`,
    )
  })

  test(`${rel} defaults to an agent that opens the gate`, () => {
    const m = src.match(/const AGENT = process\.env\.E2E_AGENT \|\| "([^"]+)"/)
    assert.ok(m, `${rel} must define an AGENT default`)
    assert.equal(
      isVibeAgentName(m[1]), true,
      `${rel} defaults to "${m[1]}", which the agent gate rejects`,
    )
  })

  test(`${rel} passes AGENT to opencode run`, () => {
    assert.ok(
      /"--agent",\s*AGENT/.test(src),
      `${rel} must pass the AGENT constant to opencode run`,
    )
  })

  test(`${rel} registers the vibe agent in the temp project config`, () => {
    // Relying on the developer's global ~/.opencode/opencode.json to define `vibe`
    // makes the harness pass here and fail on a clean machine or in CI.
    assert.ok(
      src.includes("installVibeTierAgentsInConfig"),
      `${rel} must install the vibe agent into the project config it writes`,
    )
  })
}

test("the installed agent topology actually defines a vibe agent the gate accepts", () => {
  const config = { $schema: "https://opencode.ai/config.json" }
  installVibeTierAgentsInConfig(config, {
    trinity: { cheap: { oc: "p/c" }, medium: { oc: "p/m" }, brain: { oc: "p/b" } },
  })
  assert.ok(config.agent, "installer must produce an agent block")
  assert.ok(config.agent.vibe, "topology must define the primary `vibe` agent")
  for (const name of Object.keys(config.agent)) {
    if (name === "build" || name === "plan") continue
    assert.equal(isVibeAgentName(name), true, `agent "${name}" would be gated off`)
  }
})
