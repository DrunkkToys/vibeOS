import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeSandbox(name) {
  const home = mkdtempSync(join(tmpdir(), `vibeos-${name}-`))
  mkdirSync(join(home, ".claude"), { recursive: true })
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  return home
}

test("blackbox regression: legacy stub session hydrates real tracker and leaves INIT after update", async () => {
  const home = makeSandbox("blackbox-regression")
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const turn = await import(`../../lib/turn-classify.js?blackbox-regression=${Date.now()}`)
  const sid = turn.getOC_SID()

  writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        history: [
          {
            text: "legacy session payload",
            currentRegime: "INIT",
          },
        ],
        currentRegime: "INIT",
      },
    },
  }, null, 2) + "\n")

  const tracker = turn.getBlackboxTracker()
  const before = tracker.snapshot()
  assert.equal(before.sub_regime, "INIT")

  const after = tracker.update("How do I fix this regression and what should I change?")
  assert.notEqual(after.sub_regime, "INIT")
  assert.equal(tracker.snapshot().sub_regime, after.sub_regime)
  assert.ok(typeof after.loop_intervention_level === "string")
  assert.ok(typeof after.pivot_detected === "boolean")
})
