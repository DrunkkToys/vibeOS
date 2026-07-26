import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("blackbox hot path compacts stale history and skips duplicate footer writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibeos-blackbox-hot-path-"))
  const vibeHome = join(root, ".claude")
  const previousHome = process.env.VIBEOS_HOME
  mkdirSync(vibeHome, { recursive: true })
  process.env.VIBEOS_HOME = vibeHome

  try {
    const now = new Date().toISOString()
    const sessions = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [
      `old-${index}`,
      {
        sessionId: `old-${index}`,
        updatedAt: now,
        history: Array.from({ length: 80 }, () => ({ event: "tool" })),
        pivotHistory: Array.from({ length: 80 }, () => ({ pivot: true })),
        outcomeHistory: Array.from({ length: 80 }, () => ({ outcome: "pending" })),
        control_history: Array.from({ length: 80 }, () => ({ control: { route_path: ["cheap", "medium"] } })),
      },
    ]))
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }))
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions }))

    const state = await import(`../src/lib/state.js?blackbox-hot-path=${Date.now()}`)
    state.setVibeOSHomeContext(vibeHome)
    state.setCurrentSessionId("active-session")
    const payload = {
      sessionId: "active-session",
      projectFingerprint: "perf-project",
      footerLine: "footer",
      control: { route_path: ["cheap"] },
      subRegime: "INIT",
      source: "footer",
    }

    state.recordLiveSessionSnapshot(payload)
    const stateFile = join(vibeHome, "blackbox-state.json")
    const firstWrite = statSync(stateFile).mtimeMs
    const compacted = JSON.parse(readFileSync(stateFile, "utf8"))

    assert.equal(Object.keys(compacted.sessions).length, 30)
    assert.ok(compacted.sessions["active-session"])
    for (const session of Object.values(compacted.sessions)) {
      assert.ok((session.history || []).length <= 50)
      assert.ok((session.pivotHistory || []).length <= 50)
      assert.ok((session.outcomeHistory || []).length <= 25)
      assert.ok((session.control_history || []).length <= 25)
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
    state.recordLiveSessionSnapshot(payload)
    assert.equal(statSync(stateFile).mtimeMs, firstWrite, "identical footer snapshots must not rewrite blackbox state")
  } finally {
    if (previousHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
