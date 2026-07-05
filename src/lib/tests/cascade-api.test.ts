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

  it("exports escalate() method with full response shape", () => {
    assert.ok(src.includes("async escalate("), "escalate() method must exist")
    assert.ok(src.includes("escalate"), "escalate response must include escalate")
    assert.ok(src.includes("next_tier"), "escalate response must include next_tier")
    assert.ok(src.includes("uncertainty_score"), "escalate response must include uncertainty_score")
    assert.ok(src.includes("loop_context"), "escalate response must include loop_context")
    assert.ok(src.includes("remaining_escalations"), "escalate response must include remaining_escalations")
  })

  it("classify calls POST /api/v1/mode/classify", () => {
    assert.ok(src.includes('"/api/v1/mode/classify"'), "classify must call /api/v1/mode/classify")
  })

  it("escalate calls POST /api/v1/mode/escalate", () => {
    assert.ok(src.includes('"/api/v1/mode/escalate"'), "escalate must call /api/v1/mode/escalate")
  })
})

describe("cascade-api — chat-transform.ts", () => {
  const src = readSource(join("hooks", "chat-transform.ts"))

  it("calls client.classify() in onSystemTransform", () => {
    assert.ok(src.includes("client.classify("), "onSystemTransform must call client.classify()")
  })

  it("stores entry_tier in blackbox session state", () => {
    assert.ok(src.includes("entry_tier: entryTier"), "must store entry_tier in session")
  })

  it("stores pipeline in blackbox session state", () => {
    assert.ok(src.includes("pipeline: cascadeData.pipeline || prev.pipeline"), "must store pipeline in session")
  })

  it("stores uncertainty_signals in blackbox session state", () => {
    assert.ok(src.includes("uncertainty_signals: cascadeData.uncertainty_signals || prev.uncertainty_signals"), "must store uncertainty_signals in session")
  })

  it("stores cascade_depth in blackbox session state", () => {
    assert.ok(src.includes("cascade_depth: cascadeData.cascade_depth || prev.cascade_depth || 0"), "must store cascade_depth in session")
  })

  it("writes entry_tier to selection state after syncControlSettings", () => {
    assert.ok(src.includes('writeSelection("entry_tier"'), "must write entry_tier to selection state")
  })

  it("writes pipeline to selection state after syncControlSettings", () => {
    assert.ok(src.includes('writeSelection("pipeline"'), "must write pipeline to selection state")
  })

  it("writes escalation_count: 0 to selection state", () => {
    assert.ok(src.includes('writeSelection("escalation_count"'), "must write escalation_count to selection state")
  })
})

describe("cascade-api — tool-execute.ts", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "hooks", "tool-execute.ts"), "utf-8")

  it("checks escalation pending before forcing cheap", () => {
    assert.ok(src.includes("_escalationPending"), "must check escalation pending before force-cheap")
    assert.ok(src.includes("cascade_depth > 0"), "must check cascade_depth > 0 for escalation pending")
    assert.ok(src.includes("escalation_count > 0"), "must check escalation_count > 0 for escalation pending")
  })
})

describe("cascade-api — index.ts (text.complete handler)", () => {
  const src = readFileSync(join(ROOT, "src", "index.ts"), "utf-8")

  it("imports getApiClient", () => {
    assert.ok(src.includes("getApiClient"), "must import getApiClient")
  })

  it("calls client.escalate() in text.complete handler", () => {
    assert.ok(src.includes("_clientText.escalate("), "must call escalate() in text.complete")
  })

  it("writes pending_escalation_tier on escalate", () => {
    assert.ok(src.includes('writeSelection("pending_escalation_tier"'), "must write pending_escalation_tier")
  })

  it("writes pending_escalation_loop_context on escalate", () => {
    assert.ok(src.includes('writeSelection("pending_escalation_loop_context"'), "must write pending_escalation_loop_context")
  })

  it("increments escalation_count on escalate", () => {
    assert.ok(src.includes('writeSelection("escalation_count"'), "must increment escalation_count")
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

describe("cascade-api — escalation consumption in onSystemTransform", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "hooks", "chat-transform.ts"), "utf-8")

  it("reads pending_escalation_tier from selection", () => {
    assert.ok(src.includes("pending_escalation_tier"), "onSystemTransform must check pending_escalation_tier")
  })

  it("overrides optimizationDecision.entry_slot with escalation tier", () => {
    assert.ok(src.includes('entry_slot: _pendingEscTier'), "must set entry_slot from escalation tier")
  })

  it("clears pending_escalation flags after consumption", () => {
    assert.ok(src.includes('writeSelection("pending_escalation_tier", null)'), "must clear pending_escalation_tier")
    assert.ok(src.includes('writeSelection("pending_escalation_loop_context", null)'), "must clear pending_escalation_loop_context")
  })

  it("injects escalation loop context into system prompt", () => {
    assert.ok(src.includes("escalation context"), "must inject [escalation context] into system prompt")
  })
})
