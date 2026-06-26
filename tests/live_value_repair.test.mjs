// SPDX-License-Identifier: MIT
// Live session repair contract: one helper must persist the same truth into
// delegation state and blackbox state so the footer, reward engine, and live
// session telemetry stop diverging.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeSandbox(name) {
  const root = mkdtempSync(join(tmpdir(), `vibeos-${name}-`))
  mkdirSync(join(root, ".claude"), { recursive: true })
  return root
}

test("live session snapshot writes outcome, credits, and control history to both state files", async () => {
  const root = makeSandbox("value-repair")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({
      lifetime: {},
      sessions: {},
    }, null, 2))
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({
      enabled: true,
      sessions: {},
    }, null, 2))
    writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, flow_enforce: true, tdd_enforce: true },
      trinity: { brain: { oc: "brain-model" }, medium: { oc: "medium-model" }, cheap: { oc: "cheap-model" } },
    }, null, 2))

    const state = await import("../src/lib/state.js?live-repair=" + Date.now())
    assert.equal(typeof state.recordLiveSessionSnapshot, "function", "live snapshot helper should exist")

    const snap = state.recordLiveSessionSnapshot({
      sessionId: "opencode-test-123",
      projectFingerprint: "fp-live",
      projectName: "value-repair",
      outcome: "positive",
      rewardCredits: 13,
      savingsUsd: 0.043,
      footerLine: "— 🧠 brain | provider | model | $0.04 saved | VibeQMaX · Quality | ✓ | +13 XP —",
      control: {
        enforcement_mode: "strict",
        flow_mode: "strict",
        tdd_mode: "quality",
        tier_bias: "brain",
        thinking_mode: "full",
        stress_multiplier: 1.7,
        context7_urgency: "required",
        wbp_verbosity: "verbose",
        cascade_depth: 3,
        pipeline_root: ["cheap", "medium", "brain"],
      },
      subRegime: "CONVERGING",
      resolutionState: "working",
      resolutionReason: "positive outcome",
      loopInterventionLevel: "none",
      pivotDetected: false,
      stress: 1.7,
    })

    assert.ok(snap?.updatedAt, "snapshot should return an updated timestamp")

    const delegation = JSON.parse(readFileSync(join(vibeHome, "delegation-state.json"), "utf8"))
    const blackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    const ses = delegation.sessions["opencode-test-123"]
    const bb = blackbox.sessions["opencode-test-123"]

    assert.equal(ses.reward_credits, 13, "delegation state should persist reward credits")
    assert.equal(ses.last_outcome, "positive", "delegation state should remember the last outcome")
    assert.equal(ses.live_resolution_state, "working", "delegation state should persist a live resolution state")
    assert.equal(bb.resolution_state, "working", "blackbox state should persist the same resolution state")
    assert.equal(bb.outcomeHistory?.at(-1)?.outcome, "positive", "blackbox should append the outcome trail")
    assert.equal(bb.control_history?.at(-1)?.control?.cascade_depth, 3, "blackbox should persist the live control vector")
    assert.equal(bb.control_history?.at(-1)?.control?.pipeline_root?.join(","), "cheap,medium,brain", "pipeline root should persist")
    assert.equal(bb.last_footer_line, "— 🧠 brain | provider | model | $0.04 saved | VibeQMaX · Quality | ✓ | +13 XP —", "blackbox should keep the live footer truth")
    assert.equal(ses.live_reward_breakdown ?? null, null, "no reward breakdown should remain empty when absent")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("live session snapshot persists cv aliases and revives legacy live_control state", async () => {
  const root = makeSandbox("value-repair-cv-alias")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }, null, 2))
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }, null, 2))
    writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
      selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", requested_optimization_mode: "vibeultrax" },
      trinity: { brain: { oc: "brain-model" }, medium: { oc: "medium-model" }, cheap: { oc: "cheap-model" } },
    }, null, 2))

    const state = await import("../src/lib/state.js?live-repair-cv-alias=" + Date.now())
    const control = {
      optimization_mode: "vibeultrax",
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "strict",
      tier_bias: "cheap",
      thinking_mode: "brief",
      stress_multiplier: 0.2,
      cascade_depth: 3,
      pipeline_root: ["cheap", "medium", "brain"],
      directives: ["[ultrax root] cascade profile=deep; reason=complex query"],
    }
    const normalizedControl = {
      ...control,
      cascade_root: ["cheap", "medium", "brain"],
      route_path: ["cheap", "medium", "brain"],
      selected_slot: "brain",
    }

    state.recordLiveSessionSnapshot({
      sessionId: "opencode-test-cv-alias",
      projectFingerprint: "fp-cv-alias",
      projectName: "value-repair",
      outcome: "positive",
      rewardCredits: 4,
      savingsUsd: 0.01,
      footerLine: "— ⚡ cheap | provider | model | VibeUltraX —",
      control,
      subRegime: "CONVERGING",
      resolutionState: "working",
      resolutionReason: "positive outcome",
      loopInterventionLevel: "none",
      pivotDetected: false,
      stress: 0.2,
    })

    const written = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    const session = written.sessions["opencode-test-cv-alias"]
    assert.deepEqual(session.cv, normalizedControl, "live snapshot should persist the control vector under cv")
    assert.deepEqual(session.control_vector, normalizedControl, "live snapshot should persist the control vector under control_vector")
    assert.deepEqual(session.live_control, normalizedControl, "live snapshot should keep the live_control alias")
    assert.equal(session.resolution_state, "working", "normal turn with a positive outcome should not stay unresolved")

    const legacyOnly = {
      ...session,
      cv: undefined,
      control_vector: undefined,
      live_control: normalizedControl,
    }
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({
      ...written,
      sessions: {
        ...written.sessions,
        "opencode-test-cv-alias": legacyOnly,
      },
    }, null, 2))

    const reloaded = state.loadBlackboxState()
    const revived = reloaded.sessions["opencode-test-cv-alias"]
    assert.deepEqual(revived.cv, normalizedControl, "legacy sessions with only live_control should normalize back to cv")
    assert.deepEqual(revived.control_vector, normalizedControl, "legacy sessions should normalize to control_vector too")
    assert.deepEqual(revived.live_control, normalizedControl, "legacy live_control should be preserved")
    assert.equal(revived.resolution_state, "working", "legacy normalization should keep the live resolution")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("blackbox load mirrors top-level control vector into the current session record", async () => {
  const root = makeSandbox("value-repair-root-cv")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({
      enabled: true,
      cv: {
        optimization_mode: "vibeultrax",
        tier_bias: "cheap",
        cascade_depth: 1,
        pipeline_root: ["cheap"],
      },
      sessions: {
        "opencode-test-root-cv": {
          sub_regime: "LOOPING",
          resolution: "looping",
          updatedAt: new Date().toISOString(),
        },
      },
    }, null, 2))

    const state = await import("../src/lib/state.js?live-repair-root-cv=" + Date.now())
    state.setCurrentSessionId("opencode-test-root-cv")

    const loaded = state.loadBlackboxState()
    const session = loaded.sessions["opencode-test-root-cv"]

    assert.deepEqual(session.cv, loaded.cv, "session should inherit the live control vector from the root record")
    assert.deepEqual(session.control_vector, loaded.cv, "session should keep the control_vector alias")
    assert.deepEqual(session.live_control, loaded.cv, "session should keep the live_control alias")
    const persisted = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    assert.deepEqual(persisted.sessions["opencode-test-root-cv"].cv, loaded.cv, "mirrored session cv should persist to disk")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("blackbox load normalizes stale VibeUltraX cascade fields from VIBEOS_HOME", async () => {
  const root = makeSandbox("value-repair-ultrax")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({
      enabled: true,
      cv: {
        optimization_mode: "vibeultrax",
        tier_bias: "brain",
        pipeline_root: ["cheap"],
        cascade_depth: 1,
      },
      sessions: {
        "opencode-test-ultrax": {
          cv: {
            optimization_mode: "vibeultrax",
            tier_bias: "brain",
            pipeline_root: ["cheap"],
            cascade_depth: 1,
          },
        },
      },
    }, null, 2))

    const state = await import("../src/lib/state.js?live-repair-ultrax=" + Date.now())
    state.setCurrentSessionId("opencode-test-ultrax")

    const loaded = state.loadBlackboxState()
    const session = loaded.sessions["opencode-test-ultrax"]

    assert.deepEqual(loaded.cv.cascade_root, ["cheap", "medium", "brain"])
    assert.deepEqual(loaded.cv.pipeline_root, ["cheap", "medium", "brain"])
    assert.deepEqual(loaded.cv.route_path, ["cheap"])
    assert.equal(loaded.cv.tier_bias, "cheap")
    assert.deepEqual(session.cv.cascade_root, ["cheap", "medium", "brain"])
    assert.deepEqual(session.cv.route_path, ["cheap"])
    const persisted = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    assert.deepEqual(persisted.cv.cascade_root, ["cheap", "medium", "brain"])
    assert.deepEqual(persisted.sessions["opencode-test-ultrax"].cv.cascade_root, ["cheap", "medium", "brain"])
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})
test("live session snapshot deduplicates repeated identical snapshots and preserves reward breakdown", async () => {
  const root = makeSandbox("value-repair-dedupe")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }, null, 2))
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }, null, 2))

    const state = await import("../src/lib/state.js?live-repair-dedupe=" + Date.now())
    const payload = {
      sessionId: "opencode-test-dedupe",
      outcome: "negative",
      rewardCredits: -5,
      rewardBreakdown: { quality: 0, penalty: -5 },
      savingsUsd: 0.01,
      footerLine: "footer",
      resolutionState: "needs_attention",
      resolutionReason: "negative outcome",
      nextAction: "fix the regression",
      source: "footer",
    }

    state.recordLiveSessionSnapshot(payload)
    state.recordLiveSessionSnapshot(payload)

    const delegation = JSON.parse(readFileSync(join(vibeHome, "delegation-state.json"), "utf8"))
    const blackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    const ses = delegation.sessions["opencode-test-dedupe"]
    const bb = blackbox.sessions["opencode-test-dedupe"]

    assert.equal(ses.reward_credits, -5, "duplicate identical snapshots should not double count credits")
    assert.deepEqual(ses.live_reward_breakdown, { quality: 0, penalty: -5 }, "reward breakdown should persist in delegation state")
    assert.deepEqual(bb.reward_breakdown, { quality: 0, penalty: -5 }, "reward breakdown should persist in blackbox state")
    assert.equal((bb.control_history || []).length, 0, "no control history should be written without a control vector")
    assert.equal(bb.live_snapshot_fingerprint, ses.live_snapshot_fingerprint, "both state files should share the same snapshot fingerprint")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("live session snapshot with no session id is a safe no-op", async () => {
  const root = makeSandbox("value-repair-nosid")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevRuntimeState = globalThis.__vibeOSRuntimeState
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome
  globalThis.__vibeOSRuntimeState = { apiConnected: true, apiFallbackMode: false, apiFallbackSince: null, apiEnabled: true, sessionId: "" }

  try {
    writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }, null, 2))
    writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }, null, 2))

    const state = await import("../src/lib/state.js?live-repair-nosid=" + Date.now())
    const snap = state.recordLiveSessionSnapshot({
      sessionId: "",
      outcome: "positive",
      rewardCredits: 4,
      footerLine: "footer",
    })

    assert.equal(snap.sessionId, "", "missing session id should stay empty")
    const delegation = JSON.parse(readFileSync(join(vibeHome, "delegation-state.json"), "utf8"))
    const blackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    assert.deepEqual(delegation.sessions, {}, "delegation state should stay untouched without a session id")
    assert.deepEqual(blackbox.sessions, {}, "blackbox state should stay untouched without a session id")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { globalThis.__vibeOSRuntimeState = prevRuntimeState } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("live session snapshot recovers from corrupted live state and ignores non-plain reward breakdowns", async () => {
  const root = makeSandbox("value-repair-corrupt")
  const vibeHome = join(root, ".claude")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    writeFileSync(join(vibeHome, "delegation-state.json"), "{ not valid json")
    writeFileSync(join(vibeHome, "blackbox-state.json"), "{ not valid json")

    const state = await import("../src/lib/state.js?live-repair-corrupt=" + Date.now())
    assert.doesNotThrow(() => state.recordLiveSessionSnapshot({
      sessionId: "opencode-test-corrupt",
      outcome: "positive",
      rewardCredits: 7,
      rewardBreakdown: ["bad", "shape"],
      footerLine: "footer",
      source: "footer",
    }))

    const delegation = JSON.parse(readFileSync(join(vibeHome, "delegation-state.json"), "utf8"))
    const blackbox = JSON.parse(readFileSync(join(vibeHome, "blackbox-state.json"), "utf8"))
    const ses = delegation.sessions["opencode-test-corrupt"]
    const bb = blackbox.sessions["opencode-test-corrupt"]

    assert.equal(ses.reward_credits, 7, "corrupted delegation state should recover and persist credits")
    assert.equal(bb.resolution_state, "working", "corrupted blackbox state should recover the live resolution")
    assert.equal(ses.live_reward_breakdown ?? null, null, "array-shaped reward breakdown should be ignored")
    assert.equal(bb.reward_breakdown ?? null, null, "array-shaped reward breakdown should not be persisted")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("VIBEOS_HOME remains the source of truth for live path bindings", async () => {
  const root = makeSandbox("home-source-truth")
  const firstHome = join(root, ".claude-a")
  const secondHome = join(root, ".claude-b")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = firstHome

  try {
    mkdirSync(firstHome, { recursive: true })
    mkdirSync(secondHome, { recursive: true })
    writeFileSync(join(firstHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }, null, 2))
    writeFileSync(join(secondHome, "blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }, null, 2))

    const state = await import("../src/lib/state.js?home-source-truth=" + Date.now())
    assert.equal(state.VIBEOS_HOME, firstHome, "initial binding should follow VIBEOS_HOME")
    assert.equal(state.BLACKBOX_STATE_FILE, join(firstHome, "blackbox-state.json"))
    assert.equal(state.TIERS_FILE, join(firstHome, "model-tiers.json"))

    state.setVibeOSHomeContext(secondHome)

    assert.equal(state.VIBEOS_HOME, secondHome, "binding should update when VIBEOS_HOME changes")
    assert.equal(state.BLACKBOX_STATE_FILE, join(secondHome, "blackbox-state.json"))
    assert.equal(state.TIERS_FILE, join(secondHome, "model-tiers.json"))
    assert.equal(state.REPORTS_DIR, join(secondHome, "reports"))

    state.saveBlackboxState({ enabled: true, sessions: { "sid-live": { dashboard_vectors: [{ ok: true }] } } })

    assert.equal(existsSync(join(secondHome, "blackbox-state.json")), true, "new home should receive writes")
    const written = JSON.parse(readFileSync(join(secondHome, "blackbox-state.json"), "utf8"))
    assert.equal(written.sessions["sid-live"].dashboard_vectors.length, 1)
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

test("api client persists primary env state to VIBEOS_HOME", async () => {
  const root = makeSandbox("api-env-home-source-truth")
  const vibeHome = join(root, ".claude-live")
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = root
  process.env.VIBEOS_HOME = vibeHome

  try {
    mkdirSync(vibeHome, { recursive: true })
    const api = await import("../src/lib/api-client.js?api-home-source-truth=" + Date.now())
    api.setApiToken("vos_" + "a".repeat(64))

    assert.equal(existsSync(join(vibeHome, ".env.production")), true, "primary env file should land in VIBEOS_HOME")
    assert.equal(existsSync(join(root, ".claude", ".env.production")), false, "shell home fallback must not be used")
  } finally {
    try { process.env.HOME = prevHome } catch {}
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})
