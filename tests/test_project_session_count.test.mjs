import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const home = mkdtempSync(join(tmpdir(), "vibeos-project-count-"))
mkdirSync(join(home, ".claude"), { recursive: true })
process.env.HOME = home
process.env.VIBEOS_HOME = join(home, ".claude")

const state = await import("../src/lib/state.js?t=" + Date.now())

test("project session count tracks lifetime sessions past the rolling window", () => {
  const pstate = state.loadProjectState()
  const fp = "fp-many"
  for (let i = 1; i <= 31; i++) {
    state.touchProjectBucket(pstate, fp, { sessionId: `sid-${i}`, reportId: `rep-${i}`, projectName: "Long Project" })
  }
  state.saveProjectState(pstate)

  const saved = JSON.parse(readFileSync(join(home, ".claude", "project-states.json"), "utf8"))
  assert.equal(saved.project_hashes[fp].totalSessions, 31, "lifetime totalSessions should keep growing")
  assert.equal(saved.project_hashes[fp].sessions.length, 30, "rolling session list should stay capped")
})
