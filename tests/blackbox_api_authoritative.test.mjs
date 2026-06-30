// SPDX-License-Identifier: MIT
// Contract: the remote API is authoritative for blackbox regime/loop/pivot.
// trackBlackbox must AWAIT the API analysis and persist its verdict as the
// source of truth, falling back to the local tracker only when the API is
// unreachable or exceeds BLACKBOX_API_DEADLINE_MS (3000ms).

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── Part A: network-free contract units ───────────────────────────────

test("[unit] mergeAuthoritativeBlackboxState: API verdict overrides local", async () => {
  const { mergeAuthoritativeBlackboxState } = await import("../src/lib/turn-classify.js")
  const local = { sub_regime: "REFINING", is_looping: false, loop_intervention_level: "none", pivot_detected: false }
  const api = { sub_regime: "LOOPING", is_looping: true, loop_intervention_level: "assertive", pivot_detected: true, pivot_score: 0.9 }
  const merged = mergeAuthoritativeBlackboxState(local, api)
  assert.equal(merged.sub_regime, "LOOPING", "API sub_regime wins")
  assert.equal(merged.is_looping, true, "API loop flag wins")
  assert.equal(merged.loop_intervention_level, "assertive")
  assert.equal(merged.pivot_detected, true)
  assert.equal(merged.source, "api", "merged state marked as API-sourced")
})

test("[unit] mergeAuthoritativeBlackboxState: null/garbage API falls back to local", async () => {
  const { mergeAuthoritativeBlackboxState } = await import("../src/lib/turn-classify.js")
  const local = { sub_regime: "REFINING", is_looping: false }
  assert.strictEqual(mergeAuthoritativeBlackboxState(local, null), local)
  assert.strictEqual(mergeAuthoritativeBlackboxState(local, undefined), local)
  assert.strictEqual(mergeAuthoritativeBlackboxState(local, "nope"), local)
})

test("[unit] raceWithDeadline returns value when settled in time", async () => {
  const { raceWithDeadline } = await import("../src/lib/turn-classify.js")
  const fast = new Promise((r) => setTimeout(() => r({ ok: 1 }), 5))
  const out = await raceWithDeadline(fast, 200, () => "TIMEOUT")
  assert.deepEqual(out, { ok: 1 })
})

test("[unit] raceWithDeadline falls back when the call exceeds the deadline", async () => {
  const { raceWithDeadline } = await import("../src/lib/turn-classify.js")
  const slow = new Promise((r) => setTimeout(() => r({ ok: 1 }), 200))
  const out = await raceWithDeadline(slow, 20, () => "TIMEOUT")
  assert.equal(out, "TIMEOUT", "deadline fires before the slow call settles")
})

test("[unit] raceWithDeadline swallows rejection and falls back", async () => {
  const { raceWithDeadline } = await import("../src/lib/turn-classify.js")
  const boom = Promise.reject(new Error("net down"))
  const out = await raceWithDeadline(boom, 200, () => null)
  assert.equal(out, null, "rejection routed through fallback, no unhandled rejection")
})

test("[unit] BLACKBOX_API_DEADLINE_MS is the contracted 3000ms cap", async () => {
  const { BLACKBOX_API_DEADLINE_MS } = await import("../src/lib/turn-classify.js")
  assert.equal(BLACKBOX_API_DEADLINE_MS, 3000)
})

// ── Part B: real HTTP-server end-to-end (the API actually drives state) ─

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-bbapi-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })

let analyzeHits = 0
let embeddingHits = 0
let analyzeMode = "ok" // "ok" | "fail"
let lastEmbeddingBody = null

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    const url = req.url || "/"
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)) }
    const parsedBody = body ? JSON.parse(body) : {}
    if (url.includes("/blackbox/analyze")) {
      analyzeHits++
      if (analyzeMode === "fail") return send(500, { error: "synthetic outage" })
      return send(200, {
        sub_regime: "LOOPING",
        resolution: "in_progress",
        is_looping: true,
        loop_consecutive: 3,
        loop_intervention_level: "assertive",
        loop_intervention_directive: "You appear to be looping.",
        momentum: -0.4,
      })
    }
    if (url.includes("/blackbox/select-mode-embedding")) {
      embeddingHits++
      lastEmbeddingBody = parsedBody
      return send(200, {
        ok: true,
        mode: "budget",
        embedding: {
          baseline_mode: parsedBody.optimization_mode || null,
          final_mode: "budget",
          override_applied: true,
          similarity_delta: 0.42,
        },
      })
    }
    if (url.includes("/blackbox/control-vector")) {
      return send(200, {
        optimization_mode: parsedBody.optimization_mode || "budget",
        tier_bias: parsedBody.optimization_mode === "budget" ? "cheap" : "brain",
        selected_slot: parsedBody.optimization_mode === "budget" ? "cheap" : "brain",
        pipeline_root: parsedBody.optimization_mode === "vibeultrax" ? ["cheap", "medium", "brain"] : ["cheap"],
        cascade_root: parsedBody.optimization_mode === "vibeultrax" ? ["cheap", "medium", "brain"] : ["cheap"],
        route_path: parsedBody.optimization_mode === "vibeultrax" ? ["cheap", "medium", "brain"] : ["cheap"],
        decision: {
          optimization_mode: parsedBody.optimization_mode || "budget",
          requested_mode: parsedBody.requested_mode || parsedBody.optimization_mode || "budget",
          tier_bias: parsedBody.optimization_mode === "budget" ? "cheap" : "brain",
          selected_slot: parsedBody.optimization_mode === "budget" ? "cheap" : "brain",
          pipeline_root: parsedBody.optimization_mode === "vibeultrax" ? ["cheap", "medium", "brain"] : ["cheap"],
          source: "fixture",
        },
      })
    }
    if (url.includes("/blackbox/select-mode")) return send(200, {})
    if (url.includes("/health")) return send(200, { status: "ok", version: "fixture" })
    return send(200, {})
  })
})

const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

// Env must be set BEFORE importing the plugin graph so api-client freezes our URL.
process.env.VIBEOS_API_URL = `http://127.0.0.1:${port}`
process.env.VIBEOS_HOME = join(sandbox, ".claude")

writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  selection: {
    enabled: true,
    active_slot: "cheap",
    onboarding_mode: "strict",
    optimization_mode: "vibeultrax",
    requested_optimization_mode: "vibeultrax",
  },
}))

await import("../src/index.js?bbapi=" + Date.now())
const api = await import("../src/lib/api-client.js")
const state = await import("../src/lib/state.js")
const ct = await import("../src/lib/hooks/chat-transform.js")
const turn = await import("../src/lib/turn-classify.js")

api.setApiToken("vos_" + "a".repeat(64))
state.setBlackboxEnabled(true)

function readSessions() {
  const f = join(sandbox, ".claude", "blackbox-state.json")
  if (!existsSync(f)) return {}
  return JSON.parse(readFileSync(f, "utf-8")).sessions || {}
}

function userMessage(text) {
  return [{ role: "user", parts: [{ type: "text", text }] }]
}

test("[e2e] guard: client points at the local stub", () => {
  const client = api.getApiClient()
  assert.ok(client, "client should be created after setApiToken")
  assert.equal(client.baseUrl, `http://127.0.0.1:${port}`, "baseUrl must be the stub server")
  assert.equal(api.isApiFallback(), false, "API should be live, not in fallback")
})

test("[e2e] API analysis is authoritative for the persisted regime", async () => {
  analyzeMode = "ok"
  const before = analyzeHits
  const beforeEmbedding = embeddingHits
  await turn.classifyTurnRemote("please implement a brand new caching layer for the dashboard")
  assert.ok(embeddingHits > beforeEmbedding, "the embedding selector endpoint must actually be called")
  assert.equal(lastEmbeddingBody?.optimization_mode, "vibeultrax", "session baseline mode must be forwarded to the embedding selector")
  assert.equal(turn.lastApiPredictedMode(), "budget", "embedding selector mode must be recorded as the API-predicted mode")
  await ct.onMessagesTransform({}, { messages: userMessage("please implement a brand new caching layer for the dashboard") })
  assert.ok(analyzeHits > before, "the blackbox analyze endpoint must actually be called")
  const sessions = readSessions()
  const vals = Object.values(sessions)
  assert.ok(vals.length > 0, "a session should be persisted")
  const looping = vals.find((s) => s.sub_regime === "LOOPING")
  assert.ok(looping, "persisted regime must be the API verdict (LOOPING), not the local classification")
  assert.equal(looping.is_looping, true)
  assert.equal(looping.decision_source, "api", "state must be flagged as API-sourced")
})

test("[e2e] falls back to local when the API errors", async () => {
  analyzeMode = "fail"
  // fresh session id so we observe a clean local-sourced decision
  state.resetSessionId?.()
  const before = analyzeHits
  await ct.onMessagesTransform({}, { messages: userMessage("what does the cascade router do, can you explain it") })
  assert.ok(analyzeHits > before, "analyze still attempted")
  const sessions = readSessions()
  const local = Object.values(sessions).find((s) => s.decision_source === "local")
  assert.ok(local, "a local-sourced session must exist when the API fails")
  assert.notEqual(local.sub_regime, "LOOPING", "local fallback must not carry the API verdict")
})

test("[e2e] sticky LOOPING survives a later local footer snapshot", async () => {
  const sid = "opencode-sticky-loop"
  const blackboxPath = join(sandbox, ".claude", "blackbox-state.json")
  writeFileSync(blackboxPath, JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        sub_regime: "LOOPING",
        regime: "LOOPING",
        resolution: "looping",
        resolution_state: "intervened",
        decision_source: "api",
        is_looping: true,
        loop_intervention_level: "assertive",
        loop_consecutive: 4,
        loop_hold_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        loop_release_streak: 0,
      },
    },
  }, null, 2) + "\n")
  state.setCurrentSessionId(sid)

  state.recordLiveSessionSnapshot({
    sessionId: sid,
    source: "footer",
    subRegime: "DIVERGENT",
    resolutionState: "unresolved",
    resolutionReason: "local footer attempt",
    footerLine: "footer",
    loopInterventionLevel: "none",
  })

  const sessions = readSessions()
  const sticky = sessions[sid]
  assert.ok(sticky, "sticky session should remain persisted")
  assert.equal(sticky.sub_regime, "LOOPING", "local footer snapshot must not clear API LOOPING")
  assert.equal(sticky.decision_source, "api", "API source must remain sticky")
  assert.equal(sticky.loop_intervention_level, "assertive", "existing loop intervention should survive")
  assert.equal(sticky.resolution, "looping", "loop resolution must remain looped")
})

test("[unit] sticky LOOPING releases only after consecutive API recovery turns", async () => {
  const { mergeAuthoritativeBlackboxState } = await import("../src/lib/turn-classify.js")
  const sticky = {
    sub_regime: "LOOPING",
    regime: "LOOPING",
    resolution: "looping",
    resolution_state: "intervened",
    decision_source: "api",
    is_looping: true,
    loop_intervention_level: "assertive",
    loop_consecutive: 5,
    loop_hold_until: new Date(Date.now() - 60_000).toISOString(),
    loop_release_streak: 0,
    loop_notice_signature: '{"sub_regime":"LOOPING"}',
  }
  const firstRecovery = mergeAuthoritativeBlackboxState(sticky, {
    sub_regime: "REFINING",
    regime: "REFINING",
    resolution: "unresolved",
    resolution_state: "unresolved",
    is_looping: false,
    decision_source: "api",
    loop_intervention_level: "none",
  })
  assert.equal(firstRecovery.sub_regime, "LOOPING", "first recovery turn should still hold the loop")
  assert.equal(firstRecovery.loop_release_streak, 1, "first recovery turn increments the release streak")

  const secondRecovery = mergeAuthoritativeBlackboxState(firstRecovery, {
    sub_regime: "REFINING",
    regime: "REFINING",
    resolution: "unresolved",
    resolution_state: "unresolved",
    is_looping: false,
    decision_source: "api",
    loop_intervention_level: "none",
  })
  assert.notEqual(secondRecovery.sub_regime, "LOOPING", "second consecutive API recovery turn should release the loop")
  assert.equal(secondRecovery.decision_source, "api", "release should still be API-authored")
  assert.equal(secondRecovery.loop_release_streak, 0, "release resets the hysteresis counter")
  assert.equal(secondRecovery.loop_notice_signature, null, "release clears the loop notice signature")
})

test("[unit] repeated loop notices are suppressed for the same signature", async () => {
  const { buildLoopNoticeSignature, shouldSuppressLoopNotice } = await import("../src/lib/loop-state.js")
  const current = {
    sub_regime: "LOOPING",
    resolution: "looping",
    resolution_state: "intervened",
    decision_source: "api",
    is_looping: true,
    loop_intervention_level: "assertive",
  }
  const signature = buildLoopNoticeSignature(current)
  assert.ok(signature, "a stable loop signature should be generated")
  assert.equal(
    shouldSuppressLoopNotice({ loop_notice_signature: signature }, current).suppress,
    true,
    "an identical loop signature must not re-emit the interruption",
  )
  assert.equal(
    shouldSuppressLoopNotice({ loop_notice_signature: "different" }, current).suppress,
    false,
    "a materially different loop signature should be allowed through",
  )
})

test.after(() => {
  try { server.close() } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})
