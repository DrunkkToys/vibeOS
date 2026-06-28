// SPDX-License-Identifier: MIT
// Regression: the orchestrator must NEVER write an OpenCode-watched config file
// (config.json or opencode.json) during a turn, and must NEVER call
// client.config.update.
//
// Root cause this guards (live opencode.log, 2026-06-28): every turn that picked a
// different slot called flushPendingLiveSwitch() -> client.config.update({directory}),
// which OpenCode's Config.update handler persists to <projectDir>/config.json. The
// fs-events watcher then disposes the project instance and aborts the in-flight turn
// ("disposing instance" -> AbortError). PR #357 moved the write off opencode.json but
// kept the config.update call, so the abort simply moved to config.json.
//
// New contract (subagent-delegation-only): the live primary model is pinned for the
// session. Per-turn tier routing happens via chat.params (same-provider override) and
// vibe-cheap/medium/brain subagent delegation — neither writes a watched file. applySlot
// persists active_slot to the UNWATCHED model-tiers.json only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let sandbox = null
let TIERS_FILE = ""
let OC_CONFIG = ""
const prevVibeHome = process.env.VIBEOS_HOME
const prevOcHome = process.env.OPENCODE_HOME

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-nowrite-test-"))
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    process.env.OPENCODE_HOME = sandbox
    TIERS_FILE = join(sandbox, ".claude", "model-tiers.json")
    OC_CONFIG = join(sandbox, "opencode.json")
  }
}

function writeTiers(selection = {}) {
  ensureSandbox()
  writeFileSync(TIERS_FILE, JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/brain-model" },
      medium: { oc: "deepseek/medium-model" },
      cheap: { oc: "deepseek/cheap-model" },
    },
    selection: { enabled: true, active_slot: "cheap", ...selection },
  }))
}

function writeOcConfig(model) {
  ensureSandbox()
  writeFileSync(OC_CONFIG, JSON.stringify({ model, $schema: "https://opencode.ai/config.json" }, null, 2))
}

function readOcModel() {
  return JSON.parse(readFileSync(OC_CONFIG, "utf8")).model
}

// Fake OpenCode SDK client wired exactly where pushLiveModelSwitch reads it.
// config.update MUST never be called by the new contract.
function installWiredClient() {
  const calls = []
  globalThis.__vibeOS_client = {
    config: {
      update: async (opts) => { calls.push(opts); return {} },
      get: async () => readOcModel(),
    },
  }
  return calls
}
function clearWiredClient() { delete globalThis.__vibeOS_client }

let _q = 0
function freshPricing() {
  return import("../src/lib/pricing.js?nowrite-test=" + (++_q) + "-" + Date.now())
}

test("deferred slot switch + flush writes NO config.json and makes NO config.update call", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  const calls = installWiredClient()
  try {
    const { applySlot, flushPendingLiveSwitch } = await freshPricing()

    const r = applySlot("brain", sandbox, { deferLiveSwitch: true })
    assert.ok(r.ok, `applySlot should succeed: ${r.reason || ""}`)

    const flushed = await flushPendingLiveSwitch()

    // The whole point: nothing OpenCode watches was written, and no SDK config.update fired.
    assert.equal(existsSync(join(sandbox, "config.json")), false, "no config.json created in project dir (it aborts the turn)")
    assert.equal(calls.length, 0, "client.config.update must NEVER be called (it persists config.json)")
    assert.equal(flushed, null, "flush performs no live primary switch (primary is pinned per session)")
    // active_slot (the orchestrator decision) IS persisted — to the UNWATCHED tiers file.
    assert.equal(JSON.parse(readFileSync(TIERS_FILE, "utf8")).selection.active_slot, "brain", "active_slot persisted to model-tiers.json")
  } finally {
    clearWiredClient()
  }
})

test("applySlot does NOT rewrite the watched opencode.json mid-turn (deferred OR explicit)", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  const calls = installWiredClient()
  try {
    const { applySlot } = await freshPricing()
    const before = statSync(OC_CONFIG).mtimeMs
    const beforeRaw = readFileSync(OC_CONFIG, "utf8")

    applySlot("brain", sandbox, { deferLiveSwitch: true })
    applySlot("medium", sandbox) // explicit (non-deferred) path too

    assert.equal(readFileSync(OC_CONFIG, "utf8"), beforeRaw, "opencode.json byte-for-byte unchanged (no mid-turn watched-file write)")
    assert.equal(statSync(OC_CONFIG).mtimeMs, before, "opencode.json mtime unchanged (watcher never fires)")
    assert.equal(calls.length, 0, "no config.update on any path")
    assert.equal(existsSync(join(sandbox, "config.json")), false, "still no config.json")
  } finally {
    clearWiredClient()
  }
})

test("CLEANUP", async () => {
  clearWiredClient()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = prevVibeHome
  if (prevOcHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = prevOcHome
  assert.ok(true)
})
