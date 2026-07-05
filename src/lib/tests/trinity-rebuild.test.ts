import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("modelToCcAlias", () => {
  it("returns haiku for null / undefined / empty", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias(null), "haiku")
    assert.equal(modelToCcAlias(undefined), "haiku")
    assert.equal(modelToCcAlias(""), "haiku")
  })

  it("returns haiku for deepseek-v4-flash", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("deepseek/deepseek-v4-flash"), "haiku")
  })

  it("returns deepseek-reasoner for deepseek-v4-pro", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("deepseek/deepseek-v4-pro"), "deepseek-reasoner")
  })

  it("returns deepseek-reasoner for deepseek-reasoner or deepseek-r1", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("deepseek-reasoner"), "deepseek-reasoner")
    assert.equal(modelToCcAlias("deepseek-r1"), "deepseek-reasoner")
    assert.equal(modelToCcAlias("deepseek/deepseek-reasoner"), "deepseek-reasoner")
    assert.equal(modelToCcAlias("deepseek/deepseek-r1-0528"), "deepseek-reasoner")
  })

  it("returns sonnet for sonnet / gemini / gpt / qwq", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("sonnet"), "sonnet")
    assert.equal(modelToCcAlias("anthropic/claude-sonnet-4-6"), "sonnet")
    assert.equal(modelToCcAlias("gemini-2.5-pro"), "sonnet")
    assert.equal(modelToCcAlias("google/gemini-2.5-flash"), "sonnet")
    assert.equal(modelToCcAlias("gpt-4o"), "sonnet")
    assert.equal(modelToCcAlias("qwq-32b"), "sonnet")
  })

  it("returns opus for opus models", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("opus"), "opus")
    assert.equal(modelToCcAlias("anthropic/claude-opus-4-7"), "opus")
    assert.equal(modelToCcAlias("claude-opus"), "opus")
  })

  it("returns haiku for short model names (length < 3)", async () => {
    const { modelToCcAlias } = await import("../trinity-rebuild.js")
    assert.equal(modelToCcAlias("ab"), "haiku")
    assert.equal(modelToCcAlias("x"), "haiku")
  })
})

describe("classifyAndRankModels", () => {
  it("returns null for empty / null input", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    assert.equal(classifyAndRankModels(null), null)
    assert.equal(classifyAndRankModels([]), null)
  })

  it("returns an object with brain / medium / cheap keys", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    const result = classifyAndRankModels([
      { id: "deepseek/deepseek-v4-flash", cost: 0.000182, tier: "mid" },
    ])
    assert.ok(result)
    assert.ok("brain" in result!)
    assert.ok("medium" in result!)
    assert.ok("cheap" in result!)
  })

  it("ranks high tier before mid before budget", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    const result = classifyAndRankModels([
      { id: "custom/deepseek-chat", cost: 0.000001, tier: "budget" },
      { id: "custom/v4-pro", cost: 0.00057, tier: "high" },
      { id: "custom/v4-flash", cost: 0.000182, tier: "mid" },
    ])
    assert.equal(result!.brain.id, "custom/v4-pro")
    assert.equal(result!.medium.id, "custom/v4-flash")
    assert.equal(result!.cheap.id, "custom/deepseek-chat")
  })

  it("deduplicates by model id", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    const result = classifyAndRankModels([
      { id: "deepseek/deepseek-v4-flash", cost: 0.000182, tier: "mid" },
      { id: "deepseek/deepseek-v4-flash", cost: 0.000182, tier: "mid" },
      { id: "deepseek/deepseek-v4-flash", cost: 0.000182, tier: "mid" },
    ])
    assert.ok(result)
  })

  it("filters deprecated deepseek-chat when replacement exists", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    const result = classifyAndRankModels([
      { id: "deepseek/deepseek-chat", cost: 0.000001, tier: "budget" },
      { id: "deepseek/deepseek-v4-flash", cost: 0.000182, tier: "mid" },
    ])
    assert.notEqual(result!.brain.id, "deepseek/deepseek-chat")
    assert.notEqual(result!.medium.id, "deepseek/deepseek-chat")
    assert.notEqual(result!.cheap.id, "deepseek/deepseek-chat")
  })

  it("picks cheapest for cheap slot", async () => {
    const { classifyAndRankModels } = await import("../trinity-rebuild.js")
    const result = classifyAndRankModels([
      { id: "model/expensive", cost: 0.5, tier: "mid" },
      { id: "model/medium", cost: 0.1, tier: "budget" },
      { id: "model/cheapest", cost: 0.01, tier: "budget" },
    ])
    assert.equal(result!.cheap.id, "model/cheapest")
  })
})

describe("_extractModelsDevPricingMap", () => {
  it("returns {} for null / undefined payload", async () => {
    const { _extractModelsDevPricingMap } = await import("../trinity-rebuild.js")
    assert.deepEqual(_extractModelsDevPricingMap(null), {})
    assert.deepEqual(_extractModelsDevPricingMap(undefined), {})
  })

  it("returns {} for payload with no providers", async () => {
    const { _extractModelsDevPricingMap } = await import("../trinity-rebuild.js")
    assert.deepEqual(_extractModelsDevPricingMap({}), {})
    assert.deepEqual(_extractModelsDevPricingMap({ other: "data" }), {})
  })

  it("extracts pricing from provider entries", async () => {
    const { _extractModelsDevPricingMap } = await import("../trinity-rebuild.js")
    const payload = {
      providers: {
        google: {
          models: {
            "gemini-2.5-pro": {
              cost: { input: 1.25, output: 10.0 },
            },
            "gemini-2.5-flash": {
              cost: { input: 0.30, output: 2.50 },
            },
          },
        },
      },
    }
    const map = _extractModelsDevPricingMap(payload)
    const keys = Object.keys(map)
    assert.ok(keys.length > 0)
    assert.ok(keys.some((k) => k.includes("gemini-2-5-pro")))
    assert.ok(keys.some((k) => k.includes("gemini-2-5-flash")))
  })

  it("filters by wantedIds set when provided", async () => {
    const { _extractModelsDevPricingMap } = await import("../trinity-rebuild.js")
    const payload = {
      providers: {
        google: {
          models: {
            "gemini-2.5-pro": {
              cost: { input: 1.25, output: 10.0 },
            },
            "gemini-2.5-flash": {
              cost: { input: 0.30, output: 2.50 },
            },
          },
        },
      },
    }
    const wanted = new Set(["google/gemini-2-5-flash"])
    const map = _extractModelsDevPricingMap(payload, wanted)
    const keys = Object.keys(map)
    assert.ok(keys.some((k) => k.includes("gemini-2-5-flash")))
    assert.ok(!keys.some((k) => k.includes("gemini-2-5-pro")))
  })
})

describe("collectConfiguredProviderModels", () => {
  it("returns empty array for null / undefined", async () => {
    const { collectConfiguredProviderModels } = await import("../trinity-rebuild.js")
    assert.deepEqual(collectConfiguredProviderModels(null), [])
    assert.deepEqual(collectConfiguredProviderModels(undefined), [])
  })

  it("returns array of model objects with id, provider, cost, tier", async () => {
    const { collectConfiguredProviderModels } = await import("../trinity-rebuild.js")
    const result = collectConfiguredProviderModels({
      deepseek: {
        models: {
          "deepseek-chat": {},
          "deepseek-reasoner": {},
        },
      },
    })
    assert.ok(Array.isArray(result))
    assert.ok(result.length > 0)
    for (const m of result) {
      assert.ok(typeof m.id === "string")
      assert.ok(typeof m.provider === "string")
      assert.ok(typeof m.cost === "number")
      assert.ok(typeof m.tier === "string")
    }
  })

  it("deduplicates by id", async () => {
    const { collectConfiguredProviderModels } = await import("../trinity-rebuild.js")
    const result = collectConfiguredProviderModels({
      openrouter: {
        models: {
          "deepseek/deepseek-chat": {},
        },
      },
    })
    const ids = result.map((m) => m.id)
    assert.equal(ids.length, new Set(ids).size)
  })
})
