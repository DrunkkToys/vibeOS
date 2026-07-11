import { describe, it } from "node:test"
import assert from "node:assert"

// ── Pure function from src/lib/hooks/footer.ts:114 ──

const TIER_ICON = {
  brain: "\u{1F9E0}",
  medium: "\u25D0",
  cheap: "\u26A1",
  free: "\u{1F381}",
}

function resolveTierIcon(slot) {
  return TIER_ICON[slot] || "\u26A1"
}

// ── Tests ──

describe("tier icons", () => {
  it("brain → 🧠", () => {
    assert.equal(resolveTierIcon("brain"), "\u{1F9E0}", "brain tier icon is 🧠")
  })

  it("medium → ◉", () => {
    assert.equal(resolveTierIcon("medium"), "\u25D0", "medium tier icon is ◉")
  })

  it("cheap → ⚡", () => {
    assert.equal(resolveTierIcon("cheap"), "\u26A1", "cheap tier icon is ⚡")
  })

  it("free → 🎁", () => {
    assert.equal(resolveTierIcon("free"), "\u{1F381}", "free tier icon is 🎁")
  })

  it("unknown slot defaults to ⚡", () => {
    assert.equal(resolveTierIcon("unknown"), "\u26A1", "unknown defaults to ⚡")
  })

  it("empty string defaults to ⚡", () => {
    assert.equal(resolveTierIcon(""), "\u26A1", "empty string defaults to ⚡")
  })

  it("each tier has a unique icon", () => {
    const icons = Object.values(TIER_ICON)
    const unique = new Set(icons)
    assert.equal(unique.size, icons.length, "all tier icons are unique")
  })

  it("no tier icon is empty or whitespace", () => {
    for (const [slot, icon] of Object.entries(TIER_ICON)) {
      assert.ok(icon.length > 0, `${slot} icon is not empty`)
      assert.ok(icon.trim().length > 0, `${slot} icon is not whitespace`)
    }
  })

  it("icons are single graphemes (1-2 UTF-16 units for emoji)", () => {
    for (const [slot, icon] of Object.entries(TIER_ICON)) {
      assert.ok(icon.length >= 1 && icon.length <= 2, `${slot} icon is 1-2 UTF-16 units: ${icon} (len=${icon.length})`)
    }
  })

  it("all tier slots are covered: brain, medium, cheap, free", () => {
    const required = ["brain", "medium", "cheap", "free"]
    for (const slot of required) {
      assert.ok(TIER_ICON[slot] !== undefined, `TIER_ICON has entry for ${slot}`)
    }
  })
})
