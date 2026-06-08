import { test } from "node:test"
import assert from "node:assert/strict"

const mapCV = (cv) => {
  if (!cv) return null
  const out = {}
  out.delegation_enforce = cv.enforcement_mode !== "relaxed"
  if (cv.flow_mode === "audit") {
    out.flow_enabled = false; out.flow_enforce = false
  } else {
    out.flow_enabled = true; out.flow_enforce = cv.flow_mode === "strict"
  }
  if (cv.tdd_mode === "lazy") {
    out.tdd_enforce = false; out.tdd_strict = false
  } else {
    out.tdd_enforce = true; out.tdd_strict = cv.tdd_mode === "strict"
  }
  if (cv.thinking_mode) out.thinking_level = cv.thinking_mode
  if (cv.tier_bias && cv.tier_bias !== "auto") out.active_slot = cv.tier_bias
  return out
}

test("enforcement_mode: strict → true", () => {
  assert.deepStrictEqual(mapCV({ enforcement_mode: "strict" }).delegation_enforce, true)
})
test("enforcement_mode: normal → true", () => {
  assert.deepStrictEqual(mapCV({ enforcement_mode: "normal" }).delegation_enforce, true)
})
test("enforcement_mode: relaxed → false", () => {
  assert.deepStrictEqual(mapCV({ enforcement_mode: "relaxed" }).delegation_enforce, false)
})
test("flow_mode: strict → flow_enabled=true, flow_enforce=true", () => {
  const r = mapCV({ flow_mode: "strict" })
  assert.deepStrictEqual(r.flow_enabled, true)
  assert.deepStrictEqual(r.flow_enforce, true)
})
test("flow_mode: normal → flow_enabled=true, flow_enforce=false", () => {
  const r = mapCV({ flow_mode: "normal" })
  assert.deepStrictEqual(r.flow_enabled, true)
  assert.deepStrictEqual(r.flow_enforce, false)
})
test("flow_mode: audit → flow_enabled=false, flow_enforce=false", () => {
  const r = mapCV({ flow_mode: "audit" })
  assert.deepStrictEqual(r.flow_enabled, false)
  assert.deepStrictEqual(r.flow_enforce, false)
})
test("tdd_mode: strict → tdd_enforce=true, tdd_strict=true", () => {
  const r = mapCV({ tdd_mode: "strict" })
  assert.deepStrictEqual(r.tdd_enforce, true)
  assert.deepStrictEqual(r.tdd_strict, true)
})
test("tdd_mode: quality → tdd_enforce=true, tdd_strict=false", () => {
  const r = mapCV({ tdd_mode: "quality" })
  assert.deepStrictEqual(r.tdd_enforce, true)
  assert.deepStrictEqual(r.tdd_strict, false)
})
test("tdd_mode: normal → tdd_enforce=true, tdd_strict=false", () => {
  const r = mapCV({ tdd_mode: "normal" })
  assert.deepStrictEqual(r.tdd_enforce, true)
  assert.deepStrictEqual(r.tdd_strict, false)
})
test("tdd_mode: lazy → tdd_enforce=false, tdd_strict=false", () => {
  const r = mapCV({ tdd_mode: "lazy" })
  assert.deepStrictEqual(r.tdd_enforce, false)
  assert.deepStrictEqual(r.tdd_strict, false)
})
test("thinking_mode: brief → thinking_level=brief", () => {
  assert.deepStrictEqual(mapCV({ thinking_mode: "brief" }).thinking_level, "brief")
})
test("thinking_mode: full → thinking_level=full", () => {
  assert.deepStrictEqual(mapCV({ thinking_mode: "full" }).thinking_level, "full")
})
test("thinking_mode: off → thinking_level=off", () => {
  assert.deepStrictEqual(mapCV({ thinking_mode: "off" }).thinking_level, "off")
})
test("full budget delta — all 5 fields", () => {
  const r = mapCV({ enforcement_mode: "relaxed", flow_mode: "audit", tdd_mode: "lazy", thinking_mode: "off" })
  assert.deepStrictEqual(r, {
    delegation_enforce: false, flow_enabled: false, flow_enforce: false,
    tdd_enforce: false, tdd_strict: false, thinking_level: "off"
  })
})
test("full quality delta — all 5 fields", () => {
  const r = mapCV({ enforcement_mode: "strict", flow_mode: "strict", tdd_mode: "quality", thinking_mode: "full" })
  assert.deepStrictEqual(r, {
    delegation_enforce: true, flow_enabled: true, flow_enforce: true,
    tdd_enforce: true, tdd_strict: false, thinking_level: "full"
  })
})
test("null cv → null", () => {
  assert.deepStrictEqual(mapCV(null), null)
})
test("undefined cv → null", () => {
  assert.deepStrictEqual(mapCV(undefined), null)
})
test("empty cv → all toggles true (default active), thinking untouched, no slot change", () => {
  const r = mapCV({})
  assert.deepStrictEqual(r.delegation_enforce, true)
  assert.deepStrictEqual(r.flow_enabled, true)
  assert.deepStrictEqual(r.flow_enforce, false)
  assert.deepStrictEqual(r.tdd_enforce, true)
  assert.deepStrictEqual(r.tdd_strict, false)
  assert.deepStrictEqual(r.thinking_level, undefined)
  assert.deepStrictEqual(r.active_slot, undefined)
})
test("tier_bias: cheap → active_slot=cheap", () => {
  const r = mapCV({ tier_bias: "cheap" })
  assert.deepStrictEqual(r.active_slot, "cheap")
})
test("tier_bias: brain → active_slot=brain", () => {
  const r = mapCV({ tier_bias: "brain" })
  assert.deepStrictEqual(r.active_slot, "brain")
})
test("tier_bias: medium → active_slot=medium", () => {
  const r = mapCV({ tier_bias: "medium" })
  assert.deepStrictEqual(r.active_slot, "medium")
})
test("tier_bias: auto → no active_slot change", () => {
  const r = mapCV({ tier_bias: "auto" })
  assert.deepStrictEqual(r.active_slot, undefined)
})
test("no tier_bias → no active_slot change", () => {
  const r = mapCV({ enforcement_mode: "strict" })
  assert.deepStrictEqual(r.active_slot, undefined)
})
