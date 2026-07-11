import { describe, it } from "node:test"
import assert from "node:assert"

// ── Pure function from src/lib/hooks/footer.ts:227 ──

function formatStressGauge(stress) {
  if (stress === null || stress === undefined) return ""
  const value = Number(stress)
  if (!Number.isFinite(value)) return ""
  const clamped = Math.max(0, Math.min(1, value))
  if (clamped > 0.85) return "█"
  if (clamped > 0.7) return "▆"
  if (clamped > 0.5) return "▅"
  if (clamped > 0.3) return "▃"
  if (clamped > 0.1) return "▂"
  return "▁"
}

// ── Tests ──

describe("stress gauge rendering", () => {
  const cases = [
    { input: 0,    expected: "▁", desc: "0 → ▁ (minimal)" },
    { input: 0.05, expected: "▁", desc: "0.05 → ▁ (below 0.1 threshold)" },
    { input: 0.1,  expected: "▁", desc: "0.1 → ▁ (boundary, ≤ 0.1)" },
    { input: 0.15, expected: "▂", desc: "0.15 → ▂ (just above 0.1)" },
    { input: 0.3,  expected: "▂", desc: "0.3 → ▂ (boundary, ≤ 0.3)" },
    { input: 0.35, expected: "▃", desc: "0.35 → ▃ (just above 0.3)" },
    { input: 0.4,  expected: "▃", desc: "0.4 → ▃ (in 0.3–0.5 range)" },
    { input: 0.5,  expected: "▃", desc: "0.5 → ▃ (boundary, ≤ 0.5)" },
    { input: 0.55, expected: "▅", desc: "0.55 → ▅ (just above 0.5)" },
    { input: 0.6,  expected: "▅", desc: "0.6 → ▅ (in 0.5–0.7 range)" },
    { input: 0.7,  expected: "▅", desc: "0.7 → ▅ (boundary, ≤ 0.7)" },
    { input: 0.75, expected: "▆", desc: "0.75 → ▆ (just above 0.7)" },
    { input: 0.8,  expected: "▆", desc: "0.8 → ▆ (in 0.7–0.85 range)" },
    { input: 0.85, expected: "▆", desc: "0.85 → ▆ (boundary, ≤ 0.85)" },
    { input: 0.9,  expected: "█", desc: "0.9 → █ (just above 0.85)" },
    { input: 1.0,  expected: "█", desc: "1.0 → █ (max)" },
  ]

  for (const { input, expected, desc } of cases) {
    it(desc, () => {
      assert.equal(formatStressGauge(input), expected, `formatStressGauge(${input}) should be ${expected}`)
    })
  }

  it("returns empty string for NaN", () => {
    assert.equal(formatStressGauge(NaN), "", "NaN returns empty")
  })

  it("returns empty string for Infinity", () => {
    assert.equal(formatStressGauge(Infinity), "", "Infinity returns empty")
  })

  it("returns empty string for undefined", () => {
    assert.equal(formatStressGauge(undefined), "", "undefined returns empty")
  })

  it("null returns empty string (hidden)", () => {
    assert.equal(formatStressGauge(null), "", "null → hidden, same as undefined")
  })

  it("clamps negative values to ▁", () => {
    assert.equal(formatStressGauge(-0.5), "▁", "negative clamped to 0 → ▁")
  })

  it("clamps values > 1 to █", () => {
    assert.equal(formatStressGauge(1.5), "█", "1.5 clamped to 1 → █")
  })

  it("accepts string numbers", () => {
    assert.equal(formatStressGauge("0.6"), "▅", "string '0.6' → ▅")
  })

  it("gauge characters are monotonically increasing visual weight", () => {
    const order = ["▁", "▂", "▃", "▅", "▆", "█"]
    for (let i = 0; i < order.length - 1; i++) {
      const lower = i === 0 ? 0 : [0, 0.1, 0.3, 0.5, 0.7, 0.85][i]
      const upper = [0, 0.1, 0.3, 0.5, 0.7, 0.85][i + 1]
      assert.equal(formatStressGauge(lower + 0.01), order[i], `value just above ${lower} maps to ${order[i]}`)
      assert.equal(formatStressGauge(upper), order[i], `value at ${upper} still maps to ${order[i]}`)
    }
  })
})
