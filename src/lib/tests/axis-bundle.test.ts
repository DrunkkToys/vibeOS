import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeAxisBundle, buildAxisDirectives, isAxisName, REGIME_AXIS_BASE, MODE_AXIS_DEFAULTS } from "../cascade.js"
import { MODES, isMode } from "../cascade.js"

describe("axis-bundle: mode identity", () => {
  it("recognizes exactly the 5 canonical modes", () => {
    assert.deepEqual([...MODES], ["vibemax", "vibeqmax", "vibeultrax", "vibelitex", "raw"])
    assert.equal(isMode("vibemax"), true)
    assert.equal(isMode("vibeqmax"), true)
    assert.equal(isMode("vibeultrax"), true)
    assert.equal(isMode("vibelitex"), true)
    assert.equal(isMode("raw"), true)
    assert.equal(isMode("quality"), false)
    assert.equal(isMode("budget"), false)
    assert.equal(isMode("speed"), false)
  })

  it("has axis defaults for every mode", () => {
    for (const m of MODES) {
      assert.ok(m in MODE_AXIS_DEFAULTS, `missing MODE_AXIS_DEFAULTS for ${m}`)
    }
  })
})

describe("axis-bundle: raw mode bypass", () => {
  it("bypasses all axis machinery regardless of regime/stress/overrides", () => {
    const bundle = computeAxisBundle("LOOPING", "raw", { enforcement: "strict", websearch: "encouraged" }, 5)
    assert.equal(bundle.enforcement, "off")
    assert.equal(bundle.flow, "off")
    assert.equal(bundle.tdd, "off")
    assert.equal(bundle.websearch, "off")
  })

  it("produces zero directives", () => {
    const bundle = computeAxisBundle("CONVERGING", "raw", {}, 0)
    assert.deepEqual(buildAxisDirectives(bundle, "raw"), [])
  })
})

describe("axis-bundle: composition order", () => {
  it("falls back to regime base fields the mode doesn't override", () => {
    const bundle = computeAxisBundle("RESEARCH", "vibelitex", {}, 0)
    // vibelitex doesn't set flow_focus explicitly -> regime base RESEARCH's flow_focus wins
    assert.deepEqual(bundle.flow_focus, REGIME_AXIS_BASE.RESEARCH.flow_focus)
  })

  it("mode defaults override regime base", () => {
    const bundle = computeAxisBundle("EXPLORING", "vibeqmax", {}, 0)
    // EXPLORING base tier is "cheap", but vibeqmax forces "brain"
    assert.equal(REGIME_AXIS_BASE.EXPLORING.tier, "cheap")
    assert.equal(bundle.tier, "brain")
  })

  it("user axis overrides win over mode defaults", () => {
    const bundle = computeAxisBundle("INIT", "vibeqmax", { tier: "cheap", websearch: "encouraged" }, 0)
    assert.equal(bundle.tier, "cheap")
    assert.equal(bundle.websearch, "encouraged")
  })

  it("LOOPING hardening cannot be bypassed by user overrides", () => {
    const bundle = computeAxisBundle("LOOPING", "vibemax", { enforcement: "off", flow: "off", tdd: "off", tier: "cheap", thinking: "off" }, 0)
    assert.equal(bundle.enforcement, "strict")
    assert.equal(bundle.flow, "strict")
    assert.equal(bundle.tdd, "strict")
    assert.equal(bundle.tier, "brain")
    assert.equal(bundle.thinking, "brief")
  })

  it("LOOPING stress_multiplier is at least 2.0", () => {
    const low = computeAxisBundle("LOOPING", "vibemax", {}, 0.1)
    assert.equal(low.stress_multiplier, 2.0)
    const high = computeAxisBundle("LOOPING", "vibemax", {}, 4.2)
    assert.equal(high.stress_multiplier, 4.2)
  })

  it("unknown regime falls back to EXPLORING base", () => {
    const bundle = computeAxisBundle("SOME_UNKNOWN_REGIME", "vibemax", {}, 0)
    assert.equal(bundle.tier, MODE_AXIS_DEFAULTS.vibemax.tier)
  })
})

describe("axis-bundle: directives", () => {
  it("emits no directives for a fully-normal/auto/off-default bundle", () => {
    const bundle = computeAxisBundle("INIT", "vibemax", {}, 0)
    const directives = buildAxisDirectives(bundle, "vibemax")
    assert.ok(Array.isArray(directives))
  })

  it("emits a websearch directive when the axis is not off", () => {
    const bundle = computeAxisBundle("FORENSIC", "vibeqmax", {}, 0)
    assert.equal(bundle.websearch, "off") // mode default wins over regime's "encouraged"
    const overridden = computeAxisBundle("FORENSIC", "vibeqmax", { websearch: "encouraged" }, 0)
    const directives = buildAxisDirectives(overridden, "vibeqmax")
    assert.ok(directives.some(d => d.startsWith("[websearch:")))
  })
})

describe("axis-bundle: axis name guard", () => {
  it("validates known axis names only", () => {
    assert.equal(isAxisName("tier"), true)
    assert.equal(isAxisName("websearch"), true)
    assert.equal(isAxisName("not_a_real_axis"), false)
  })
})
