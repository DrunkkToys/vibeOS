import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

function readSource(rel: string): string {
  return readFileSync(join(ROOT, "src", "lib", rel), "utf-8")
}

describe("cascade-api — api-client.ts", () => {
  const src = readSource("api-client.ts")

  it("exports classify() method with full response shape", () => {
    assert.ok(src.includes("async classify("), "classify() method must exist")
    assert.ok(src.includes("entry_tier"), "classify response must include entry_tier")
    assert.ok(src.includes("pipeline"), "classify response must include pipeline")
    assert.ok(src.includes("uncertainty_signals"), "classify response must include uncertainty_signals")
    assert.ok(src.includes("cascade_depth"), "classify response must include cascade_depth")
    assert.ok(src.includes("resolved_tier"), "classify response must include resolved_tier")
  })

  it("classify calls POST /api/v1/mode/classify", () => {
    assert.ok(src.includes('"/api/v1/mode/classify"'), "classify must call /api/v1/mode/classify")
  })
})

describe("cascade-api — chat-transform.ts stores BE-authoritative resolved_tier", () => {
  const src = readSource(join("hooks", "chat-transform.ts"))

  it("calls client.classify() in onSystemTransform", () => {
    assert.ok(src.includes("client.classify("), "onSystemTransform must call client.classify()")
  })

  it("stores cascade_depth in blackbox session state", () => {
    assert.ok(src.includes("cascade_depth: cascadeData.cascade_depth || prev.cascade_depth || 0"), "must store cascade_depth in session")
  })

  it("stores resolved_tier as the single BE-authoritative tier signal", () => {
    assert.ok(src.includes("resolved_tier:"), "must store resolved_tier in session")
  })

  it("falls back to the classify response's tier/entry_tier when resolved_tier itself is missing", () => {
    const start = src.indexOf("const resolvedTier =")
    assert.ok(start >= 0, "resolvedTier computation must exist")
    const body = src.slice(start, start + 400)
    assert.ok(body.includes("cascadeData.tier"), "must fall back to cascadeData.tier when resolved_tier is absent")
    assert.ok(body.includes("cascadeData.entry_tier"), "must fall back to cascadeData.entry_tier when tier is also absent")
  })

  it("logs when a successful classify call returns no usable data (silent no-op guard)", () => {
    const start = src.indexOf("const cascadeData = await client.classify(")
    assert.ok(start >= 0, "classify call must exist")
    const body = src.slice(start, start + 1400)
    assert.ok(/else\s*{[^}]*console\.(warn|error)/.test(body), "must log when cascadeData is falsy instead of silently no-oping")
  })

  it("does NOT write a pending_escalation_tier selection-state flag (single-path collapse)", () => {
    assert.ok(!src.includes('writeSelection("pending_escalation_tier"'), "pending_escalation_tier producer must be removed")
    assert.ok(!src.includes('writeSelection("pending_escalation_loop_context"'), "pending_escalation_loop_context producer must be removed")
  })

  it("does NOT contain a second escalation re-route/consume block", () => {
    assert.ok(!src.includes("_pendingEscTier"), "escalation re-route consumer must be removed")
    assert.ok(!src.includes("Escalation re-route"), "escalation re-route block must be removed")
  })

  it("does NOT inject [escalation context] into the system prompt (dead producer removed)", () => {
    assert.ok(!src.includes("_escalationLoopContext"), "escalation loop context variable must be removed")
    assert.ok(!src.includes("[escalation context]"), "escalation context system-prompt injection must be removed")
  })

  it("still writes a resolved_tier while the API is in fallback mode (local cascade estimate)", () => {
    assert.ok(src.includes("computeDifficulty"), "must import/use computeDifficulty for a local resolved_tier estimate")
    const gateStart = src.indexOf("if (latestUserIntent && isApiConnected() && !isApiFallback())")
    assert.ok(gateStart >= 0, "BE classify gate must exist")
    const afterGate = src.slice(gateStart, gateStart + 2600)
    assert.ok(/else if\s*\(latestUserIntent\)/.test(afterGate), "must have a fallback branch that still runs when the BE classify path is gated off")
    assert.ok(afterGate.includes("suggestedTier"), "fallback branch must derive a tier from computeDifficulty's suggestedTier")
    assert.ok(afterGate.includes("resolved_tier:"), "fallback branch must still persist resolved_tier so it never stays frozen at None")
  })
})

describe("cascade-api — tool-execute.ts single-source-of-truth routing", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "hooks", "tool-execute.ts"), "utf-8")

  it("subagent routing reads the single source of truth (control-vector worker_slot)", () => {
    assert.ok(src.includes("selection.worker_slot"), "subagent must read worker_slot from selection state")
    assert.ok(src.includes("ONE source of truth"), "subagent routing must document the single source of truth")
    assert.ok(!src.includes("creditForceCheap"), "credit force-cheap layer must be removed")
    assert.ok(!src.includes("cascade-escape"), "final cascade-escape override layer must be removed")
  })

  it("_ultraSlot() reads BE resolved_tier directly instead of only model-string matching", () => {
    const ultraSlotStart = src.indexOf("const _ultraSlot = ()")
    assert.ok(ultraSlotStart >= 0, "_ultraSlot function must exist")
    const ultraSlotBody = src.slice(ultraSlotStart, ultraSlotStart + 600)
    assert.ok(ultraSlotBody.includes("resolved_tier"), "_ultraSlot must read resolved_tier from blackbox session")
  })

  it("does NOT contain the duplicate uncertainty-cap escalation producer (second competing writer)", () => {
    assert.ok(!src.includes("Cascade escalation via uncertainty detection"), "uncertainty-cap escalation block must be removed")
    assert.ok(!src.includes("_client.escalate("), "duplicate escalate() call in tool-execute.ts must be removed")
    assert.ok(!src.includes('_writeSelection("pending_escalation_tier"'), "duplicate pending_escalation_tier producer must be removed")
  })
})

describe("cascade-api — index.ts no longer has duplicate escalation producers", () => {
  const src = readFileSync(join(ROOT, "src", "index.ts"), "utf-8")

  it("does NOT call _clientText.escalate() anywhere (3 duplicate copies removed)", () => {
    assert.ok(!src.includes("_clientText.escalate("), "duplicate escalate() calls in index.ts must be removed")
  })

  it("does NOT write pending_escalation_tier/pending_escalation_loop_context from index.ts", () => {
    assert.ok(!src.includes('writeSelection("pending_escalation_tier"'), "index.ts must not write pending_escalation_tier")
    assert.ok(!src.includes('writeSelection("pending_escalation_loop_context"'), "index.ts must not write pending_escalation_loop_context")
  })
})

describe("cascade-api — footer cascade depth", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "hooks", "footer.ts"), "utf-8")

  it("reads cascade_depth from blackbox session state", () => {
    assert.ok(src.includes("cascade_depth"), "footer must read cascade_depth from session state")
  })

  it("maps cascade_depth to cascadeIcon", () => {
    assert.ok(src.includes("cascadeIcon") && src.includes("cascadeDepthForIcon"), "footer must map cascade_depth to cascadeIcon")
  })
})
