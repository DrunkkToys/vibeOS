import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeSandbox(name) {
  const home = mkdtempSync(join(tmpdir(), `vibeos-${name}-`))
  mkdirSync(join(home, ".claude"), { recursive: true })
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "medium",
      enabled: true,
      delegation_enforce: false,
      flow_enabled: false,
      flow_enforce: false,
      tdd_enforce: false,
      tdd_strict: false,
      thinking_level: "off",
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
  }, null, 2) + "\n")
  return home
}

test("bootstrapOptimizationSession resets a fresh restart to budget", async () => {
  const home = makeSandbox("bootstrap-budget")
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  const turn = await import(`../../lib/turn-classify.js?bootstrap=${Date.now()}`)
  const sid = turn.getOC_SID()
  writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
    sessions: {
      [sid]: {
        optimization_mode: "speed",
        active_slot: "medium",
      },
    },
  }, null, 2) + "\n")

  const boot = turn.bootstrapOptimizationSession()
  assert.deepStrictEqual(boot, { mode: "budget", slot: "cheap" })

  const disk = JSON.parse(readFileSync(join(home, ".claude/blackbox-state.json"), "utf8"))
  assert.equal(disk.sessions[sid].optimization_mode, "budget")
})

test("applyBudgetFirstMode hardens LOOPING to quality even before interaction counters settle", async () => {
  const home = makeSandbox("loop-gate")
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  const turn = await import(`../../lib/turn-classify.js?turn=${Date.now()}`)
  const sid = turn.getOC_SID()
  writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
    sessions: {
      [sid]: {
        n_interactions: 1,
        sub_regime: "LOOPING",
        regime: "LOOPING",
      },
    },
  }, null, 2) + "\n")

  const modePolicy = await import(`../../lib/mode-policy.js?policy=${Date.now()}`)
  const first = modePolicy.applyBudgetFirstMode({
    requestedMode: "budget",
    suggestedMode: "speed",
    subRegime: "LOOPING",
    stress: 0,
    nInteractions: 1,
  })
  assert.equal(first.mode, "quality")
  assert.equal(first.active, true)

  const second = modePolicy.applyBudgetFirstMode({
    requestedMode: "budget",
    suggestedMode: "speed",
    subRegime: "LOOPING",
    stress: 0,
    nInteractions: 2,
  })
  assert.equal(second.mode, "quality")
  assert.equal(second.active, true)
})
