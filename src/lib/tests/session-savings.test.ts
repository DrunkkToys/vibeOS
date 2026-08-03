import test from "node:test"
import assert from "node:assert/strict"

const ss = await import("../session-savings.js?test=" + Date.now())

test("session-savings: verified savings are read and rounded", () => {
  assert.equal(ss.getSessionVerifiedSavings({ verified_savings_usd: 1.23456 }), 1.2346)
  assert.equal(ss.getSessionVerifiedSavings({}), 0)
  assert.equal(ss.getSessionVerifiedSavings(null), 0)
})

test("session-savings: verified savings do not come from est estimates", () => {
  const session = { verified_savings_usd: 0.42, total_savings_usd: 5, warns: [{ est_savings_usd: 4.5 }] }
  assert.equal(ss.getSessionVerifiedSavings(session), 0.42)
  assert.notEqual(ss.getSessionVerifiedSavings(session), ss.getSessionWarnSavings(session))
})

test("session-savings: diagnostics surface divergence between estimates and verified", () => {
  const session = { verified_savings_usd: 0.1, total_savings_usd: 5, live_savings_usd: 0, warns: [] }
  const d = ss.getSessionSavingsDiagnostics(session)
  assert.ok(d.diverged, "verified vs estimate divergence should be flagged")
})
