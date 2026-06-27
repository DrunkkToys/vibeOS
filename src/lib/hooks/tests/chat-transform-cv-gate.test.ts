// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"

const mapCV = (cv: Record<string, any> | null | undefined): Record<string, any> | null => {
  if (!cv) return null
  const out: Record<string, any> = {}
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

// ── delegation_enforce respects enforcement_mode in normal mode ──

test("normal mode: enforcement_mode=relaxed → delegation_enforce=false", () => {
  assert.strictEqual(mapCV({ enforcement_mode: "relaxed" }).delegation_enforce, false)
})

test("normal mode: enforcement_mode=normal → delegation_enforce=true", () => {
  assert.strictEqual(mapCV({ enforcement_mode: "normal" }).delegation_enforce, true)
})

test("normal mode: enforcement_mode=strict → delegation_enforce=true", () => {
  assert.strictEqual(mapCV({ enforcement_mode: "strict" }).delegation_enforce, true)
})

test("normal mode: no enforcement_mode → delegation_enforce=true (default on)", () => {
  assert.strictEqual(mapCV({}).delegation_enforce, true)
})

// ── enforcement_mode combined with other CV fields ──

test("vibemax/budget CV: relaxed enforcement, audit flow, lazy tdd, off thinking", () => {
  const r = mapCV({ enforcement_mode: "relaxed", flow_mode: "audit", tdd_mode: "lazy", thinking_mode: "off" })
  assert.deepStrictEqual(r, {
    delegation_enforce: false,
    flow_enabled: false, flow_enforce: false,
    tdd_enforce: false, tdd_strict: false,
    thinking_level: "off",
  })
})

test("quality CV: strict enforcement, strict flow, quality tdd, full thinking", () => {
  const r = mapCV({ enforcement_mode: "strict", flow_mode: "strict", tdd_mode: "quality", thinking_mode: "full" })
  assert.deepStrictEqual(r, {
    delegation_enforce: true,
    flow_enabled: true, flow_enforce: true,
    tdd_enforce: true, tdd_strict: false,
    thinking_level: "full",
  })
})

test("mixed CV: normal enforcement, strict flow, lazy tdd", () => {
  const r = mapCV({ enforcement_mode: "normal", flow_mode: "strict", tdd_mode: "lazy", thinking_mode: "brief" })
  assert.deepStrictEqual(r, {
    delegation_enforce: true,
    flow_enabled: true, flow_enforce: true,
    tdd_enforce: false, tdd_strict: false,
    thinking_level: "brief",
  })
})

// ── tier_bias combined with enforcement_mode ──

test("tier_bias cheap + relaxed enforcement", () => {
  const r = mapCV({ tier_bias: "cheap", enforcement_mode: "relaxed" })
  assert.strictEqual(r.active_slot, "cheap")
  assert.strictEqual(r.delegation_enforce, false)
})

test("tier_bias brain + strict enforcement", () => {
  const r = mapCV({ tier_bias: "brain", enforcement_mode: "strict" })
  assert.strictEqual(r.active_slot, "brain")
  assert.strictEqual(r.delegation_enforce, true)
})

test("tier_bias auto: no active_slot set", () => {
  const r = mapCV({ tier_bias: "auto", enforcement_mode: "normal" })
  assert.strictEqual(r.active_slot, undefined)
  assert.strictEqual(r.delegation_enforce, true)
})

// ── null/undefined CV ──

test("null CV → null", () => {
  assert.strictEqual(mapCV(null), null)
})

test("undefined CV → null", () => {
  assert.strictEqual(mapCV(undefined), null)
})
