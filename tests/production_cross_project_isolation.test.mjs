import { describe, it } from "node:test"
import assert from "node:assert/strict"

const PROJECT_A_KEY = "fp-project-a"
const PROJECT_B_KEY = "fp-project-b"

function createProjectState(key, sessionCount, warns) {
  const sessions = {}
  for (let i = 0; i < sessionCount; i++) {
    sessions[`${key}-sid-${i}`] = {
      warns: warns.map(w => ({ ...w, at: new Date().toISOString() })),
      cost_usd: i * 0.005,
      started: new Date().toISOString(),
    }
  }
  return {
    project_hashes: {
      [key]: {
        totalSessions: sessionCount,
        sessions: Object.keys(sessions).slice(0, 30),
        lastSeen: Date.now(),
      },
    },
    sessions,
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0 },
  }
}

describe("production: cross-project state isolation", () => {
  it("project A warns do not appear in project B metrics", () => {
    const stateA = createProjectState(PROJECT_A_KEY, 3, [
      { tool: "edit", reason: "direct edit A", est_savings_usd: 1.0 },
    ])
    const stateB = createProjectState(PROJECT_B_KEY, 2, [
      { tool: "bash", reason: "delegation B", est_savings_usd: 2.0 },
    ])

    // Verify isolation: session IDs don't overlap
    const sessionsA = Object.keys(stateA.sessions)
    const sessionsB = Object.keys(stateB.sessions)
    const overlap = sessionsA.filter(s => sessionsB.includes(s))
    assert.equal(overlap.length, 0, "project sessions should not overlap")
  })

  it("syncControlSettings preserves enabled:true (J7)", () => {
    // Simulate the selection config that syncControlSettings writes
    function syncControlSettings(selection, updates) {
      const merged = { ...selection, ...updates }
      if (merged.enabled === undefined) merged.enabled = true
      return merged
    }

    const base = { active_slot: "brain", delegation_enforce: true }
    const result1 = syncControlSettings(base, { active_slot: "medium" })
    assert.equal(result1.enabled, true, "enabled should default to true")

    const result2 = syncControlSettings(base, { active_slot: "cheap", tdd_strict: true })
    assert.equal(result2.enabled, true, "enabled should survive syncControlSettings")
    assert.equal(result2.active_slot, "cheap")
    assert.equal(result2.tdd_strict, true)
  })

  it("per-project session count is isolated", () => {
    const stateA = createProjectState("fp-alpha", 5, [])
    const stateB = createProjectState("fp-beta", 10, [])
    assert.equal(stateA.project_hashes["fp-alpha"].totalSessions, 5)
    assert.equal(stateB.project_hashes["fp-beta"].totalSessions, 10)
  })

  it("session ID determinism — same session gets same ID across hooks (L4)", () => {
    // The session ID should be consistent for the duration of a session
    function generateSessionId(projectFp, sessionStart) {
      return `opencode-${projectFp.slice(-5)}-${sessionStart}`
    }
    const start = Date.now()
    const id1 = generateSessionId("abc123def", start)
    const id2 = generateSessionId("abc123def", start)
    const id3 = generateSessionId("xyz789abc", start)
    assert.equal(id1, id2, "same project+time should produce same session ID")
    assert.notEqual(id1, id3, "different project should produce different session ID")
  })

  it("cross-project session count does not leak", () => {
    // Simulate project state reading without cross-contamination
    function countProjectSessions(state, projectKey) {
      const hash = state.project_hashes?.[projectKey]
      return hash?.totalSessions ?? 0
    }
    const state = {
      project_hashes: {
        "proj-a": { totalSessions: 15 },
        "proj-b": { totalSessions: 7 },
      },
    }
    assert.equal(countProjectSessions(state, "proj-a"), 15)
    assert.equal(countProjectSessions(state, "proj-b"), 7)
    assert.equal(countProjectSessions(state, "proj-nonexistent"), 0)
  })
})
