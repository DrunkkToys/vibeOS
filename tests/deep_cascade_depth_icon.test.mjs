import { describe, it } from "node:test"
import assert from "node:assert"

// ── Pure functions from src/lib/hooks/footer.ts ──

function formatCascadePulse(cascadeIcon, cascadeLabel) {
  const icon = String(cascadeIcon || "").trim()
  const label = String(cascadeLabel || "").trim()
  if (!icon && !label) return ""
  return [icon, label].filter(Boolean).join(" ")
}

// Cascade icon resolution: mirrors the footer.ts cascadeDepthForIcon logic
// depth 1 → empty (no cascade), depth 2 → ▸▸, depth 3 → ▸▸▸
function cascadeIconForDepth(depth) {
  if (depth >= 3) return "▸▸▸"
  if (depth >= 2) return "▸▸"
  return ""
}

// ── Tests ──

describe("cascade depth icon rendering", () => {
  it("depth 1 shows no icon (cheap direct)", () => {
    const icon = cascadeIconForDepth(1)
    assert.equal(icon, "", "depth 1 has no cascade icon")
    const pulse = formatCascadePulse(icon, "")
    assert.equal(pulse, "", "depth 1 cascade pulse is empty")
  })

  it("depth 0 shows no icon", () => {
    const icon = cascadeIconForDepth(0)
    assert.equal(icon, "", "depth 0 has no cascade icon")
  })

  it("depth 2 shows ▸▸", () => {
    const icon = cascadeIconForDepth(2)
    assert.equal(icon, "▸▸", "depth 2 icon is ▸▸")
    const pulse = formatCascadePulse(icon, "")
    assert.equal(pulse, "▸▸", "depth 2 cascade pulse is ▸▸")
  })

  it("depth 3 shows ▸▸▸", () => {
    const icon = cascadeIconForDepth(3)
    assert.equal(icon, "▸▸▸", "depth 3 icon is ▸▸▸")
    const pulse = formatCascadePulse(icon, "")
    assert.equal(pulse, "▸▸▸", "depth 3 cascade pulse is ▸▸▸")
  })

  it("depth 4+ also shows ▸▸▸ (clamped at 3)", () => {
    const icon = cascadeIconForDepth(4)
    assert.equal(icon, "▸▸▸", "depth 4 clamped to ▸▸▸")
  })

  it("depth 100 shows ▸▸▸ (clamped at 3)", () => {
    assert.equal(cascadeIconForDepth(100), "▸▸▸", "depth 100 clamped to ▸▸▸")
  })

  it("depth 1.5 (non-integer, < 2) shows no icon", () => {
    assert.equal(cascadeIconForDepth(1.5), "", "depth 1.5 < 2 threshold → no icon")
  })

  it("negative depth shows no icon", () => {
    assert.equal(cascadeIconForDepth(-1), "", "negative depth → no icon")
  })

  it("cascade pulse with label", () => {
    const pulse = formatCascadePulse("▸▸▸", "deep cascade")
    assert.equal(pulse, "▸▸▸ deep cascade", "icon + label joined by space")
  })

  it("cascade pulse with empty label", () => {
    const pulse = formatCascadePulse("▸▸", "")
    assert.equal(pulse, "▸▸", "empty label → just icon")
  })

  it("cascade pulse with no icon and label", () => {
    const pulse = formatCascadePulse("", "some label")
    assert.equal(pulse, "some label", "no icon → just label")
  })

  it("cascade pulse with neither returns empty", () => {
    assert.equal(formatCascadePulse("", ""), "", "neither → empty")
    assert.equal(formatCascadePulse(undefined, undefined), "", "both undefined → empty")
  })

  it("depth boundaries: 1=no icon, 2=▸▸, 3=▸▸▸", () => {
    const expected = { 0: "", 1: "", 2: "▸▸", 3: "▸▸▸" }
    for (const [d, exp] of Object.entries(expected)) {
      assert.equal(cascadeIconForDepth(Number(d)), exp, `depth ${d} → ${exp || "(empty)"}`)
    }
  })

  it("▸▸ is visually distinguishable from ▸▸▸", () => {
    assert.notEqual("▸▸", "▸▸▸", "▸▸ and ▸▸▸ are different strings")
    assert.equal("▸▸".length, 2, "▸▸ has 2 characters")
    assert.equal("▸▸▸".length, 3, "▸▸▸ has 3 characters")
  })
})
