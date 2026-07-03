// SPDX-License-Identifier: MIT
import { after, test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-turn-truth-"))
const vibeHome = join(sandbox, ".claude")
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = vibeHome
mkdirSync(vibeHome, { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({
  enabled: true,
  sessions: {
    "sid-turn-truth": {
      active_slot: "brain",
      sub_regime: "CLOSED",
      control_vector: { cascade_depth: 3 },
    },
  },
}, null, 2))
writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }, null, 2))
writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "brain",
    optimization_mode: "vibeultrax",
    requested_optimization_mode: "vibeultrax",
    delegation_enforce: true,
    flow_enforce: true,
    tdd_enforce: true,
  },
  trinity: {
    brain: { oc: "deepseek/v4-pro" },
    medium: { oc: "z-ai/glm-4.6" },
    cheap: { oc: "deepseek/v4-flash" },
  },
}, null, 2))
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({ model: "deepseek/v4-pro", plugin: ["vibeOS"] }, null, 2))

after(() => {
  try { process.env.HOME = prevHome } catch {}
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

test("turn ledger stores a joinable route and finalize record", async () => {
  const ledger = await import("../src/lib/turn-ledger.js")
  const state = await import("../src/lib/state.js")
  state.setCurrentSessionId("sid-turn-truth")

  ledger.recordTurnRoute({
    sessionId: "sid-turn-truth",
    turnId: "turn-123",
    prompt: "find the root cause and escalate if needed",
    plannedRoute: {
      selectedModel: "deepseek/v4-flash",
      selectedSlot: "cheap",
      source: "ml",
      routePath: ["cheap"],
      cascadeDepth: 1,
    },
    executedRoute: {
      selectedModel: "deepseek/v4-flash",
      selectedSlot: "cheap",
      source: "cascade",
      routePath: ["cheap", "medium", "brain"],
      cascadeDepth: 3,
      bridgeId: "bridge-123",
      status: "completed",
      contributedToFinalAnswer: true,
    },
  })
  ledger.recordTurnFinalize({
    sessionId: "sid-turn-truth",
    turnId: "turn-123",
    finalized: {
      finalVisibleModel: "deepseek/v4-flash",
      finalVisibleSlot: "cheap",
      finalVisibleProvider: "deepseek",
      finalVisibleProviderLabel: "Deepseek",
      finalVisibleModelName: "V4 Flash",
      footerLine: "footer",
      cascadeDepth: 3,
      claimTag: "✓",
    },
  })

  assert.ok(existsSync(join(vibeHome, "turn-ledger.jsonl")), "turn ledger should be written")
  const latest = ledger.getLatestTurnTruth("sid-turn-truth")
  assert.equal(latest?.turnId, "turn-123")
  assert.equal(latest?.executedRoute?.bridgeId, "bridge-123")
  assert.equal(latest?.finalized?.finalVisibleModel, "deepseek/v4-flash")
  assert.equal(latest?.finalized?.cascadeDepth, 3)
})

test("claim verification only substantiates against the same session when sessionId is provided", async () => {
  const claims = await import("../src/lib/claim-verification.js?claim-session=" + Date.now())
  const auditDir = join(vibeHome, "cascade-audit")
  mkdirSync(auditDir, { recursive: true })
  writeFileSync(join(auditDir, "cascade-audit.jsonl"), [
    JSON.stringify({
      _ts: new Date().toISOString(),
      sessionId: "other-session",
      turnId: "other-turn",
      selectedSlot: "brain",
      selectedModel: "deepseek/v4-pro",
      routePath: ["cheap", "medium", "brain"],
      executed: true,
    }),
  ].join("\n"))

  const mismatch = claims.evaluateClaimVerification({
    text: "I fixed it and all tests are passing",
    vibeHome,
    sessionId: "sid-turn-truth",
    now: Date.now(),
    windowMs: 120000,
  })
  assert.equal(mismatch.unsubstantiatedCount, 1, "a different session must not substantiate the claim")

  writeFileSync(join(auditDir, "cascade-audit.jsonl"), [
    JSON.stringify({
      _ts: new Date().toISOString(),
      sessionId: "sid-turn-truth",
      turnId: "turn-123",
      selectedSlot: "cheap",
      selectedModel: "deepseek/v4-flash",
      routePath: ["cheap", "medium", "brain"],
      executed: true,
    }),
  ].join("\n"))

  const match = claims.evaluateClaimVerification({
    text: "I fixed it and all tests are passing",
    vibeHome,
    sessionId: "sid-turn-truth",
    turnId: "turn-123",
    now: Date.now(),
    windowMs: 120000,
  })
  assert.equal(match.unsubstantiatedCount, 0)
  assert.equal(match.claimTag, "✓ evidence")
})

test("footer projects the latest executed turn truth instead of stale blackbox slot", async () => {
  const state = await import("../src/lib/state.js")
  const ledger = await import("../src/lib/turn-ledger.js")
  const footer = await import("../src/lib/hooks/footer.js?footer-turn-truth=" + Date.now())
  state.setCurrentSessionId("sid-turn-truth")
  ledger.recordTurnRoute({
    sessionId: "sid-turn-truth",
    turnId: "turn-footer",
    prompt: "read logs and summarize",
    executedRoute: {
      selectedModel: "deepseek/v4-flash",
      selectedSlot: "cheap",
      source: "cascade",
      routePath: ["cheap", "medium", "brain"],
      cascadeDepth: 3,
      status: "completed",
      contributedToFinalAnswer: true,
    },
  })
  ledger.recordTurnFinalize({
    sessionId: "sid-turn-truth",
    turnId: "turn-footer",
    finalized: {
      finalVisibleModel: "deepseek/v4-flash",
      finalVisibleSlot: "cheap",
      finalVisibleProvider: "deepseek",
      finalVisibleProviderLabel: "Deepseek",
      finalVisibleModelName: "V4 Flash",
      cascadeDepth: 3,
    },
  })

  const output = { text: "This message is long enough to trigger the footer and verify the executed turn truth wins over stale slot state." }
  await footer._appendFooter({ args: { model: "deepseek/v4-pro" } }, output)
  const line = output.text.split("\n").pop() || ""
  assert.ok(line.includes("⚡ cheap"), "footer should show the final visible cheap slot from turn truth: " + line)
  assert.ok(line.includes("V4 Flash"), "footer should show the final visible model from turn truth: " + line)
  assert.ok(line.includes("▸▸▸"), "footer should show executed cascade depth from turn truth: " + line)
  assert.ok(!line.includes("🧠 brain"), "footer should not fall back to stale brain slot: " + line)
})
