import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-session-bridge-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "brain",
    slot_locked: false,
    optimization_mode: "vibeultrax",
    thinking_level: "full",
    flow_enabled: true,
    flow_enforce: true,
    delegation_enforce: true,
    tdd_enforce: true,
    tdd_strict: true,
    tdd_quality: true,
    requested_optimization_mode: "vibeultrax",
  },
}, null, 2))

writeFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), JSON.stringify({
  session_started_at: new Date().toISOString(),
  sessions: {
    "sid-bridge": {
      orchestration: {
        session_id: "sid-bridge",
        status: "active",
        locked: false,
        archived: false,
        tags: ["plan", "flow"],
        notes: [{ id: "n1", text: "keep the plan and flow state", created_at: new Date().toISOString() }],
        lifecycle: { started_at: new Date().toISOString(), paused_at: null, resumed_at: null, archived_at: null, checked_out_at: null },
        template: { id: "tmpl-1", label: "Save", body: "plan", revision: 1, active: true, signature: "tmpl-1:1:abc" },
        version: 1,
        history: [{ version: 1, action: "annotate", at: new Date().toISOString(), payload: { note: "plan" }, snapshot: { session_id: "sid-bridge", status: "active", locked: false, archived: false, tags: ["plan"], notes: [], lifecycle: { started_at: null, paused_at: null, resumed_at: null, archived_at: null, checked_out_at: null }, template: null, version: 1 } }],
      },
    },
  },
}, null, 2))

writeFileSync(join(process.env.VIBEOS_HOME, "global-learning.json"), JSON.stringify({
  ml_cache_raw: JSON.stringify({
    entries: [{
      hash: "cache-hash-1",
      tool: "Read",
      prompt: "fetch the current plan and flow state",
      sizeBytes: 4096,
      at: new Date().toISOString(),
      ageSec: 42,
      words: ["fetch", "plan", "flow"],
    }],
    stats: {
      Read: { tool: "Read", hits: 3, total: 4, bytesSaved: 2048, lastHit: new Date().toISOString(), hitRate: 0.75 },
    },
  }),
  updatedAt: new Date().toISOString(),
}, null, 2))

writeFileSync(join(process.env.VIBEOS_HOME, "active-jobs.json"), JSON.stringify({
  "fp-123": {
    project_fingerprint: "fp-123",
    project_name: "demo",
    prompt: "keep the current plan alive",
    status: "active",
    updatedAt: new Date().toISOString(),
  },
  "fp-bridge": {
    project_fingerprint: "fp-bridge",
    project_name: "demo",
    prompt: "write the bridge test",
    status: "active",
    updatedAt: new Date().toISOString(),
  },
}, null, 2))

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
  assert.ok(bridge.prompt_prefix.includes("\"flow_enabled\":true"))
  assert.ok(bridge.prompt_prefix.includes("\"tdd_strict\":true"))
  assert.ok(bridge.prompt_prefix.includes("\"entries\":1"))
  assert.ok(bridge.prompt_prefix.includes("\"status\":\"active\""))
  assert.ok(bridge.prompt_prefix.includes("carry_forward=implement the new session bridge"))
  assert.ok(bridge.bridge_key)
  assert.ok(bridge.tags.some((tag) => tag.startsWith("bridge:")))
  assert.equal(bridge.selection.active_slot, "brain")
  assert.equal(bridge.orchestration.status, "active")
  assert.equal(bridge.cache.entries, 1)
  assert.equal(bridge.active_job?.prompt || "", "keep the current plan alive")
})

test("session bridge records the handoff in session history and closes the active job entry", () => {
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
  assert.ok(!activeJobs[bridge.bridge_id], "bridge record is not left as a live active job")
  assert.ok(activeJobs["fp-bridge"], "existing project job remains available")
  assert.equal(activeJobs["fp-bridge"].status, "active")
})

test("session bridge dedupes repeated hook emissions for the same session", () => {
  const first = buildSessionBridge({
    sessionId: "sid-dedupe",
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
  const second = buildSessionBridge({
    sessionId: "sid-dedupe",
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

  assert.equal(first.bridge_key, second.bridge_key)
  assert.equal(recordSessionBridge(first), true)
  assert.equal(recordSessionBridge(second), false)

  const delegationState = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), "utf-8"))
  const session = delegationState.sessions?.["sid-dedupe"]
  const batches = session?.orchestration?.history?.filter((entry) => entry.action === "batch") || []
  assert.equal(batches.length, 1)

  const activeJobs = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "active-jobs.json"), "utf-8"))
  assert.ok(!activeJobs[first.bridge_id], "deduped bridge does not remain active")
})

test("legacy session bridge records are removed when active jobs reload", async () => {
  const raw = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "active-jobs.json"), "utf-8"))
  raw["legacy-bridge"] = {
    kind: "session-bridge",
    status: "handoff",
    bridge_id: "legacy-bridge",
    session_id: "sid-legacy",
    prompt_prefix: "[session bridge]\nbridge_id=legacy-bridge\n",
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }
  writeFileSync(join(process.env.VIBEOS_HOME, "active-jobs.json"), JSON.stringify(raw, null, 2))

  const { getActiveJobForProject } = await import("../src/lib/state.js?" + Date.now())
  assert.equal(getActiveJobForProject("fp-legacy"), null)

  const cleaned = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "active-jobs.json"), "utf-8"))
  assert.ok(!cleaned["legacy-bridge"], "stale bridge record is removed during reload")
})
