// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { installVibeTierAgentsInConfig as installScript } from "../scripts/lib/vibe-tier-agents.mjs"
import { installVibeTierAgentsInConfig as installRuntime } from "../src/lib/runtime-config.js"

const TIERS = { trinity: { cheap: { oc: "p/cheap" }, medium: { oc: "p/medium" }, brain: { oc: "p/brain" } } }
const installers = [
  ["deploy", (cfg) => installScript(cfg, TIERS)],
  ["runtime", (cfg) => installRuntime(cfg, TIERS.trinity)],
]

for (const [name, install] of installers) {
  test(`${name}: an unset default_agent stays unset`, () => {
    const cfg = {}
    install(cfg)
    assert.equal(cfg.default_agent, undefined)
    assert.equal(cfg.agent.vibe.mode, "primary")
  })

  test(`${name}: the user's default_agent is kept`, () => {
    for (const agent of ["build", "plan", "vibe", "claude", "my-agent"]) {
      const cfg = { default_agent: agent }
      install(cfg)
      assert.equal(cfg.default_agent, agent)
    }
  })

  test(`${name}: a vibe tier subagent left as default_agent is removed`, () => {
    const cfg = { default_agent: "vibe-brain" }
    assert.equal(install(cfg), true)
    assert.equal(cfg.default_agent, undefined)
  })
}
