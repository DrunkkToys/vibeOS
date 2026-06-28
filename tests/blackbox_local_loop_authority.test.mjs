import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-local-loop-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "cheap",
    optimization_mode: "vibeultrax",
    flow_enabled: true,
    flow_enforce: true,
    delegation_enforce: true,
    tdd_enforce: true,
  },
}, null, 2))

writeFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), JSON.stringify({
  session_started_at: new Date().toISOString(),
  sessions: {},
}, null, 2))

const { ResolutionTracker } = await import("../src/vibeOS-lib/blackbox/resolution-tracker.js?local-loop=" + Date.now())
const { recordLiveSessionSnapshot } = await import("../src/lib/state.js?local-loop=" + Date.now())

test("local inspection churn stays advisory and does not canonicalize LOOPING", () => {
  const rt = new ResolutionTracker("local-inspection", 12)
  const activity = {
    tool: "read",
    action: "inspect",
    target: "src/lib/state.ts",
    signature: "read:src/lib/state.ts",
  }
  let state = null
  for (const text of [
    "read the session state",
    "read the session state again",
    "read the session state one more time",
  ]) {
    state = rt.update(
      text,
      ResolutionTracker.extractFeatures(text),
      "read",
      0.25,
      0.1,
      null,
      activity,
    )
  }

  assert.ok(state, "expected a state snapshot")
  assert.notEqual(state.sub_regime, "LOOPING", "inspection churn must not become canonical LOOPING")
  assert.equal(state.is_looping, false, "inspection churn must stay non-canonical")
  assert.equal(state.loop_authority, "advisory-local", "inspection churn should only be advisory")
  assert.equal(state.loop_detector_kind, "inspection-repeat", "inspection churn should be labeled correctly")
  assert.ok((state.loop_detector_confidence || 0) < 0.8, "advisory confidence should stay below authoritative threshold")
})

test("repeated failed mutation on the same target becomes authoritative LOOPING", () => {
  const rt = new ResolutionTracker("local-failure", 12)
  const activity = {
    tool: "edit",
    action: "update",
    target: "src/lib/state.ts",
    signature: "edit:src/lib/state.ts",
    outcome: "negative",
  }
  let state = null
  for (const text of [
    "patch the state merge again",
    "retry the same state merge patch",
    "another attempt to patch the same state merge",
  ]) {
    state = rt.update(
      text,
      ResolutionTracker.extractFeatures(text),
      "edit",
      0.8,
      0.7,
      null,
      activity,
    )
  }

  assert.ok(state, "expected a state snapshot")
  assert.equal(state.sub_regime, "LOOPING", "repeated failed mutation should become canonical LOOPING")
  assert.equal(state.is_looping, true, "failed mutation loops must be canonical")
  assert.equal(state.loop_authority, "authoritative-local", "failed mutation loops should be authoritative")
  assert.equal(state.loop_detector_kind, "failed-mutation-repeat", "failed mutation loops should be classified correctly")
  assert.ok((state.loop_detector_confidence || 0) >= 0.8, "authoritative loop confidence should stay high")
})

test("local loop state clears on healthy recomputation and writes a loop audit record", () => {
  const sid = "local-loop-recovery"
  const blackboxPath = join(process.env.VIBEOS_HOME, "blackbox-state.json")
  writeFileSync(blackboxPath, JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        sub_regime: "LOOPING",
        regime: "LOOPING",
        resolution: "looping",
        resolution_state: "intervened",
        decision_source: "local",
        is_looping: true,
        loop_authority: "advisory-local",
        loop_detector_kind: "inspection-repeat",
        loop_detector_confidence: 0.55,
        loop_source_reason: "repeated inspection churn",
        loop_intervention_level: "none",
      },
    },
  }, null, 2) + "\n")

  const result = recordLiveSessionSnapshot({
    sessionId: sid,
    source: "footer",
    subRegime: "REFINING",
    resolutionState: "working",
    resolutionReason: "healthy recovery",
    footerLine: "— recovery",
  })

  assert.equal(result.sessionId, sid)

  const persisted = JSON.parse(readFileSync(blackboxPath, "utf-8"))
  const session = persisted.sessions[sid]
  assert.ok(session, "session should remain persisted")
  assert.notEqual(session.sub_regime, "LOOPING", "healthy recomputation must clear local LOOPING")
  assert.equal(session.is_looping, false, "healthy recomputation must clear loop flag")
  assert.notEqual(session.decision_source, "api", "local recovery must not invent API authority")

  const auditPath = join(process.env.VIBEOS_HOME, "loop-audit.jsonl")
  assert.ok(existsSync(auditPath), "loop audit file should be created")
  const auditLines = readFileSync(auditPath, "utf-8").trim().split("\n").filter(Boolean)
  assert.ok(auditLines.length > 0, "loop audit file should record the transition")
  const last = JSON.parse(auditLines[auditLines.length - 1])
  assert.equal(last.session_id, sid)
  assert.equal(last.previous_regime, "LOOPING")
  assert.equal(last.next_regime, "REFINING")
  assert.equal(last.decision_source, "local")
})
