import { describe, it } from "node:test"
import assert from "node:assert/strict"

const PROVIDER_TIERS = {
  brain: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
  medium: { oc: "opencode-go/mimo-v2.5", cc: "opencode-go/mimo-v2.5" },
  cheap: { oc: "opencode/big-pickle", cc: "opencode/big-pickle" },
}

function resolveModel(tiers, slot) {
  return tiers?.[slot]?.oc || null
}

describe("production: multi-provider model tiers", () => {
  it("deepseek/ prefix resolves as brain slot", () => {
    const model = resolveModel(PROVIDER_TIERS, "brain")
    assert.ok(model)
    assert.ok(model.includes("deepseek"))
    assert.equal(model, "deepseek/deepseek-v4-flash")
  })

  it("opencode-go/ prefix resolves as medium slot", () => {
    const model = resolveModel(PROVIDER_TIERS, "medium")
    assert.ok(model)
    assert.ok(model.includes("opencode-go"))
    assert.equal(model, "opencode-go/mimo-v2.5")
  })

  it("opencode/ prefix resolves as cheap slot", () => {
    const model = resolveModel(PROVIDER_TIERS, "cheap")
    assert.ok(model)
    assert.ok(model.includes("opencode"))
    assert.equal(model, "opencode/big-pickle")
  })

  it("all three provider formats coexist", () => {
    const brain = PROVIDER_TIERS.brain.oc
    const medium = PROVIDER_TIERS.medium.oc
    const cheap = PROVIDER_TIERS.cheap.oc
    assert.notEqual(brain.split("/")[0], medium.split("/")[0])
    assert.notEqual(medium.split("/")[0], cheap.split("/")[0])
    assert.notEqual(brain.split("/")[0], cheap.split("/")[0])
  })

  it("missing tier returns null gracefully", () => {
    assert.equal(resolveModel(PROVIDER_TIERS, "nonexistent"), null)
    assert.equal(resolveModel({}, "brain"), null)
    assert.equal(resolveModel(null, "brain"), null)
  })

  it("empty oc field returns null", () => {
    const tiers = { brain: { oc: "" } }
    assert.equal(resolveModel(tiers, "brain"), null)
  })
})
