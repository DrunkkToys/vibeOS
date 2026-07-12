// SPDX-License-Identifier: MIT
// Contract: the footer must never synthesize a "negative" outcome purely from
// already being in a LOOPING + stressed state and report it back to the
// remote blackbox outcome tracker (or the local reward engine as a lie
// penalty). Doing so creates a self-reinforcing feedback loop: LOOPING ->
// synthetic negative outcome -> API sees another negative outcome ->
// negative-outcome-repeat confidence rises -> stays LOOPING. Only an
// EXPLICIT outcome signal (real positive/negative language) may be reported
// to the outcome tracker or penalized by the reward engine.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-no-passive-negative-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })

let outcomeHits = 0
let lastOutcomeBody = null

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    const url = req.url || "/"
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)) }
    const parsedBody = body ? JSON.parse(body) : {}
    if (url.includes("/blackbox/analyze")) {
      return send(200, {
        sub_regime: "LOOPING",
        resolution: "in_progress",
        is_looping: true,
        loop_consecutive: 3,
        loop_intervention_level: "assertive",
        momentum: -0.4,
      })
    }
    if (url.includes("/blackbox/outcome")) {
      outcomeHits++
      lastOutcomeBody = parsedBody
      return send(200, { ok: true })
    }
    if (url.includes("/blackbox/select-mode-embedding")) {
      return send(200, { ok: true, mode: "quality", embedding: { override_applied: false } })
    }
    if (url.includes("/blackbox/select-mode")) return send(200, {})
    if (url.includes("/health")) return send(200, { status: "ok", version: "fixture" })
    return send(200, {})
  })
})

const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

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
    active_slot: "brain",
    onboarding_mode: "strict",
    optimization_mode: "vibeultrax",
    requested_optimization_mode: "vibeultrax",
  },
}))

await import("../src/index.js?nopn=" + Date.now())
const api = await import("../src/lib/api-client.js")
const state = await import("../src/lib/state.js")
const ct = await import("../src/lib/hooks/chat-transform.js")
const footer = await import("../src/lib/hooks/footer.js")
const turn = await import("../src/lib/turn-classify.js")

api.setApiToken("vos_" + "a".repeat(64))
state.setBlackboxEnabled(true)

function userMessage(text) {
  return [{ role: "user", parts: [{ type: "text", text }] }]
}

function forceLooping() {
  turn.setLatestBlackboxState({
    enabled: true,
    sub_regime: "LOOPING",
    is_looping: true,
    resolution: "looping",
    loop_intervention_level: "assertive",
    momentum: -0.4,
  })
}

// Stressed but with no explicit positive/negative completion language.
const STRESSED_TEXT = "This is urgent and critical, I need this now, please hurry, we are still failing again and again"

test("passively-inferred LOOPING+stressed negative outcome must not reach the API outcome tracker", async () => {
  try {
    // Set latestUserIntent (drives the stress score) then pin the regime to
    // LOOPING deterministically -- the internal resolution/decay dynamics of
    // a real multi-turn session are not what this test is about.
    await ct.onMessagesTransform({}, { messages: userMessage(STRESSED_TEXT) })
    forceLooping()

    const turn1 = { text: "I implemented the new caching layer for the dashboard." }
    await footer._appendFooter({ args: { model: "deepseek/deepseek-v4-pro" } }, turn1)

    await ct.onMessagesTransform({}, { messages: userMessage(STRESSED_TEXT) })
    forceLooping()

    const turn2 = { text: "Continuing the verification pass on the caching layer." }
    await footer._appendFooter({ args: { model: "deepseek/deepseek-v4-pro" } }, turn2)

    assert.equal(outcomeHits, 0, `no explicit negative/positive text ever occurred, so the outcome tracker must not be called: last body = ${JSON.stringify(lastOutcomeBody)}`)
    assert.ok(!/-\d+ XP/.test(turn2.text), `no lie/meta-work penalty should apply from a synthesized outcome: ${turn2.text.slice(-200)}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
