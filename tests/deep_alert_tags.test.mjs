import { describe, it } from "node:test"
import assert from "node:assert"

// ── Pure function from src/lib/hooks/footer.ts:301 ──

function buildFooterAlert(opts) {
  opts = opts || {}
  const alerts = []
  if (opts.apiSlow) alerts.push("⚠ api slow")
  if (opts.apiDegraded && String(opts.lastModelError || "").trim()) alerts.push("⚠ api degraded")
  const expectedToCompare = opts.pendingLiveModel || opts.expectedModel
  if (opts.liveModel && expectedToCompare && opts.liveModel !== expectedToCompare) {
    if (opts.pendingLiveModel) { alerts.push("⚠ switch pending") } else { alerts.push("⚠ model drift") }
  }
  const err = String(opts.lastModelError || "")
  if (err && (err.includes("EHOSTUNREACH") || err.includes("ENOTFOUND") || err.includes("ETIMEDOUT"))) {
    alerts.push("⚠ model unreachable")
  }
  return alerts.join(" · ")
}

// ── Tests ──

describe("alert tags", () => {
  it("empty opts returns empty string", () => {
    assert.equal(buildFooterAlert({}), "", "no alerts → empty")
  })

  it("null returns empty string", () => {
    assert.equal(buildFooterAlert(null), "", "null → empty")
  })

  it("undefined returns empty string", () => {
    assert.equal(buildFooterAlert(undefined), "", "undefined → empty")
  })

  it("⚠ api slow when apiSlow=true", () => {
    const result = buildFooterAlert({ apiSlow: true })
    assert.equal(result, "⚠ api slow", "api slow alert")
  })

  it("⚠ api degraded when apiDegraded=true and lastModelError present", () => {
    const result = buildFooterAlert({ apiDegraded: true, lastModelError: "fetch failed" })
    assert.equal(result, "⚠ api degraded", "api degraded alert")
  })

  it("⚠ api degraded NOT shown without lastModelError", () => {
    const result = buildFooterAlert({ apiDegraded: true })
    assert.equal(result, "", "no error string → no degraded alert")
  })

  it("⚠ switch pending when liveModel differs from pendingLiveModel", () => {
    const result = buildFooterAlert({ liveModel: "model-a", pendingLiveModel: "model-b" })
    assert.equal(result, "⚠ switch pending", "switch pending alert")
  })

  it("⚠ model drift when liveModel differs from expectedModel (no pending)", () => {
    const result = buildFooterAlert({ liveModel: "model-a", expectedModel: "model-b" })
    assert.equal(result, "⚠ model drift", "model drift alert")
  })

  it("no alert when liveModel matches expectedModel", () => {
    const result = buildFooterAlert({ liveModel: "model-a", expectedModel: "model-a" })
    assert.equal(result, "", "matching models → no alert")
  })

  it("⚠ model unreachable for EHOSTUNREACH error", () => {
    const result = buildFooterAlert({ lastModelError: "fetch failed: EHOSTUNREACH" })
    assert.equal(result, "⚠ model unreachable", "EHOSTUNREACH → unreachable")
  })

  it("⚠ model unreachable for ENOTFOUND error", () => {
    const result = buildFooterAlert({ lastModelError: "getaddrinfo ENOTFOUND api.example.com" })
    assert.equal(result, "⚠ model unreachable", "ENOTFOUND → unreachable")
  })

  it("⚠ model unreachable for ETIMEDOUT error", () => {
    const result = buildFooterAlert({ lastModelError: "connect ETIMEDOUT 1.2.3.4:443" })
    assert.equal(result, "⚠ model unreachable", "ETIMEDOUT → unreachable")
  })

  it("multiple alerts joined by ·", () => {
    const result = buildFooterAlert({
      apiSlow: true,
      apiDegraded: true,
      lastModelError: "EHOSTUNREACH",
    })
    assert.ok(result.includes("⚠ api slow"), "has api slow")
    assert.ok(result.includes("⚠ api degraded"), "has api degraded")
    assert.ok(result.includes("⚠ model unreachable"), "has model unreachable")
    assert.ok(result.includes(" · "), "joined by ·")
  })

  it("switch pending takes priority over model drift", () => {
    const result = buildFooterAlert({
      liveModel: "model-a",
      pendingLiveModel: "model-b",
      expectedModel: "model-c",
    })
    assert.ok(result.includes("⚠ switch pending"), "switch pending present")
    assert.ok(!result.includes("⚠ model drift"), "model drift NOT present")
  })

  it("all alert types have ⚠ prefix", () => {
    const cases = [
      "⚠ api slow",
      "⚠ api degraded",
      "⚠ switch pending",
      "⚠ model drift",
      "⚠ model unreachable",
    ]
    for (const c of cases) {
      assert.ok(c.startsWith("⚠ "), `${c} starts with ⚠ prefix`)
    }
  })
})
