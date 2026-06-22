import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-session-bridge-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

const { buildSessionBridge, recordSessionBridge } = await import("../src/lib/session-bridge.js?" + Date.now())

test("session bridge builds a carry-forward prompt for the next session", () => {
  const bridge = buildSessionBridge({
    sessionId: "sid-bridge",
    fromModel: "deepseek/deepseek-v4-pro",
    fromTier: "brain",
    toModel: "deepseek/deepseek-v4-flash",
    toTier: "medium",
    reason: "cascade escalation",
    prompt: "implement the new session bridge",
    activePipeline: ["cheap", "medium", "brain"],
    projectFingerprint: "fp-123",
    projectName: "demo",
    sourceStrategy: "cascade",
  })

  assert.equal(bridge.session_id, "sid-bridge")
  assert.equal(bridge.from_model, "deepseek/deepseek-v4-pro")
  assert.equal(bridge.to_model, "deepseek/deepseek-v4-flash")
  assert.ok(bridge.prompt_prefix.startsWith("[session bridge]"))
  assert.ok(bridge.prompt_prefix.includes("pipeline=cheap -> medium -> brain"))
  assert.ok(bridge.prompt_prefix.includes("carry_forward=implement the new session bridge"))
  assert.ok(bridge.tags.some((tag) => tag.startsWith("bridge:")))
})

test("session bridge records the handoff in session history and active jobs", () => {
  const bridge = buildSessionBridge({
    sessionId: "sid-history",
    fromModel: "deepseek/deepseek-v4-pro",
    fromTier: "brain",
    toModel: "opencode/big-pickle",
    toTier: "cheap",
    reason: "task escalation",
    prompt: "write the bridge test",
    activePipeline: ["cheap", "medium", "brain"],
    projectFingerprint: "fp-bridge",
    projectName: "demo",
    sourceStrategy: "backend",
  })

  assert.equal(recordSessionBridge(bridge), true)

  const delegationState = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), "utf-8"))
  const session = delegationState.sessions?.["sid-history"]
  assert.ok(session, "session record exists")
  assert.ok(Array.isArray(session.orchestration?.history), "history exists")
  const lastHistory = session.orchestration.history.at(-1)
  assert.equal(lastHistory.action, "batch")
  assert.ok(String(lastHistory.payload?.actions?.[0]?.payload?.note || "").includes("task escalation"))

  const activeJobsFile = join(process.env.VIBEOS_HOME, "active-jobs.json")
  assert.ok(existsSync(activeJobsFile), "active jobs file exists")
  const activeJobs = JSON.parse(readFileSync(activeJobsFile, "utf-8"))
  assert.ok(activeJobs[bridge.bridge_id], "bridge record stored as an active job")
  assert.equal(activeJobs[bridge.bridge_id].status, "handoff")
})
