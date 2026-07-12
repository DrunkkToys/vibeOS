// SPDX-License-Identifier: MIT
// Real cascade test: the footer tier label and the cascade depth icon must both
// come from the SAME persisted route_path — so a Task-subagent escalation to
// medium/brain is reflected in the footer instead of showing "cheap" while the
// icon shows ▸▸/▸▸▸. See CLAUDE.md "Model Switch Contract" for the applySlot
// constraints this test also guards.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function withSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), name))
  const vibeHome = join(sandbox, ".claude")
  mkdirSync(vibeHome, { recursive: true })
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = vibeHome
  return {
    sandbox,
    vibeHome,
    ocConfig: join(sandbox, "opencode.json"),
    tiersFile: join(vibeHome, "model-tiers.json"),
    blackboxFile: join(vibeHome, "blackbox-state.json"),
    cleanup() {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
      else process.env.VIBEOS_HOME = prevVibeHome
    },
  }
}

function writeTiers(tiersFile, workerSlot) {
  writeFileSync(tiersFile, JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
      worker_slot: workerSlot,
    },
    trinity: {
      cheap: { oc: "test/cheap-model" },
      medium: { oc: "test/medium-model" },
      brain: { oc: "test/brain-model" },
    },
  }, null, 2))
}

// ── Unit coverage for resolveActiveCascadeTier ──────────────────────────────

test("resolveActiveCascadeTier: depth-1 stays cheap", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-1=" + Date.now())
  const res = sf.resolveActiveCascadeTier({ liveSession: { route_path: ["cheap"] } })
  assert.equal(res.tier, "cheap")
  assert.equal(res.depth, 1)
})

test("resolveActiveCascadeTier: depth-2 escalation reads medium off route_path", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-2=" + Date.now())
  const res = sf.resolveActiveCascadeTier({ liveSession: { route_path: ["cheap", "medium"] } })
  assert.equal(res.tier, "medium")
  assert.equal(res.depth, 2)
})

test("resolveActiveCascadeTier: depth-3 escalation reads brain off route_path", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-3=" + Date.now())
  const res = sf.resolveActiveCascadeTier({ liveSession: { route_path: ["cheap", "medium", "brain"] } })
  assert.equal(res.tier, "brain")
  assert.equal(res.depth, 3)
})

test("resolveActiveCascadeTier: falls back to pipeline_root + cascade_depth when route_path is missing", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-4=" + Date.now())
  const res = sf.resolveActiveCascadeTier({
    liveSession: { pipeline_root: ["cheap", "medium", "brain"], cascade_depth: 2 },
  })
  assert.equal(res.tier, "medium")
  assert.equal(res.depth, 2)
})

test("resolveActiveCascadeTier: cold start with no session state falls back to cheap, does not throw", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-5=" + Date.now())
  assert.doesNotThrow(() => {
    const res = sf.resolveActiveCascadeTier({})
    assert.equal(res.tier, "cheap")
  })
})

test("resolveActiveCascadeTier: disk session used when live session has no route_path", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-6=" + Date.now())
  const res = sf.resolveActiveCascadeTier({
    liveSession: {},
    diskSession: { route_path: ["cheap", "medium", "brain"] },
  })
  assert.equal(res.tier, "brain")
  assert.equal(res.depth, 3)
})

test("resolveActiveCascadeTier: a real legacyDepth of 0 (no escalation) must not be reported as depth 3", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-7=" + Date.now())
  const res = sf.resolveActiveCascadeTier({
    liveSession: {},
    diskSession: {},
    legacyDepth: 0,
    liveModel: "deepseek/deepseek-v4-flash",
    trinityBrain: "deepseek/deepseek-v4-flash",
  })
  assert.equal(res.tier, "brain")
  assert.equal(res.depth, 0, "a direct, non-cascaded brain-tier call must show depth 0, not the nominal 3")
})

test("resolveActiveCascadeTier: missing legacyDepth still falls back to the tier's nominal depth", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-8=" + Date.now())
  const res = sf.resolveActiveCascadeTier({
    liveSession: {},
    diskSession: {},
    liveModel: "deepseek/deepseek-v4-flash",
    trinityBrain: "deepseek/deepseek-v4-flash",
  })
  assert.equal(res.tier, "brain")
  assert.equal(res.depth, 3, "with no tracked depth at all, the nominal brain depth should still be assumed")
})

// ── Integration: Task-subagent escalation persists route_path, and the footer ──
// resolver (fed with that persisted state) agrees with the escalated tier,
// regardless of which hook (tool.execute.after vs text.complete) reads it.

async function runTaskRouting(ctx, workerSlot) {
  writeTiers(ctx.tiersFile, workerSlot)
  writeFileSync(ctx.blackboxFile, JSON.stringify({ sessions: {} }))
  writeFileSync(join(ctx.vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }))
  if (!existsSync(ctx.ocConfig)) {
    writeFileSync(ctx.ocConfig, JSON.stringify({ model: "test/cheap-model", plugin: ["vibeOS"] }, null, 2))
  }

  const idx = await import("../src/index.js?tier-truth-idx=" + Date.now())
  const hooks = await idx.DelegationEnforcer({ client: {}, directory: ctx.sandbox })

  // DelegationEnforcer assigns its own session id on load; read it back so the
  // test can pre-seed blackbox-state.json under the id the hook will actually use.
  const state = await import("../src/lib/state.js?tier-truth-state=" + Date.now())
  const sid = state.getCurrentSessionId()
  const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
  bbState.sessions[sid] = {}
  writeFileSync(ctx.blackboxFile, JSON.stringify(bbState))

  // Bootstrap (session start) may legitimately touch opencode.json once (tier
  // agent topology install) — the contract under test is that the per-turn
  // tool.execute.before hook itself never rewrites it again.
  const ocMtimeAfterBootstrap = existsSync(ctx.ocConfig) ? statSync(ctx.ocConfig).mtimeMs : null

  const args = { description: "escalated task", prompt: "implement something", subagent_type: null, model: null }
  await hooks["tool.execute.before"]({ tool: "task" }, { args })

  return { sid, args, ocMtimeAfterBootstrap }
}

test("depth-1 (cheap) Task routing: route_path persisted as [cheap], resolver agrees", async () => {
  const ctx = withSandbox("vibeos-tier-truth-cheap-")
  try {
    const { sid } = await runTaskRouting(ctx, "cheap")
    const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    assert.deepEqual(bbState.sessions[sid].route_path, ["cheap"])

    const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-check-cheap=" + Date.now())
    const res = sf.resolveActiveCascadeTier({ liveSession: bbState.sessions[sid] })
    assert.equal(res.tier, "cheap")
  } finally {
    ctx.cleanup()
  }
})

test("depth-2 (medium) Task routing: route_path persisted ending in medium, resolver agrees, icon depth 2", async () => {
  const ctx = withSandbox("vibeos-tier-truth-medium-")
  try {
    const { sid } = await runTaskRouting(ctx, "medium")
    const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    const routePath = bbState.sessions[sid].route_path
    assert.equal(routePath[routePath.length - 1], "medium")

    const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-check-medium=" + Date.now())
    const res = sf.resolveActiveCascadeTier({ liveSession: bbState.sessions[sid] })
    assert.equal(res.tier, "medium")
    assert.equal(res.depth, 2)
  } finally {
    ctx.cleanup()
  }
})

test("depth-3 (brain) Task routing: route_path persisted ending in brain, resolver agrees, icon depth 3", async () => {
  const ctx = withSandbox("vibeos-tier-truth-brain-")
  try {
    const { sid } = await runTaskRouting(ctx, "brain")
    const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    const routePath = bbState.sessions[sid].route_path
    assert.equal(routePath[routePath.length - 1], "brain")

    const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-check-brain=" + Date.now())
    const res = sf.resolveActiveCascadeTier({ liveSession: bbState.sessions[sid] })
    assert.equal(res.tier, "brain")
    assert.equal(res.depth, 3)
  } finally {
    ctx.cleanup()
  }
})

test("cross-hook agreement: tool.execute.after-style and text.complete-style reads of the same session produce the same tier", async () => {
  const ctx = withSandbox("vibeos-tier-truth-cross-")
  try {
    const { sid } = await runTaskRouting(ctx, "brain")
    const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    const sf = await import("../src/lib/hooks/shared-footer.js?tier-truth-cross=" + Date.now())
    // Both hook paths call the same resolveActiveCascadeTier with the same
    // persisted session state — structurally guaranteed to agree.
    const fromToolExecuteAfter = sf.resolveActiveCascadeTier({ liveSession: bbState.sessions[sid] })
    const fromTextComplete = sf.resolveActiveCascadeTier({ liveSession: bbState.sessions[sid], diskSession: bbState.sessions[sid] })
    assert.equal(fromToolExecuteAfter.tier, fromTextComplete.tier)
    assert.equal(fromToolExecuteAfter.depth, fromTextComplete.depth)
  } finally {
    ctx.cleanup()
  }
})

test("escalation regression guard: Task-subagent routing never rewrites opencode.json/config.json", async () => {
  const ctx = withSandbox("vibeos-tier-truth-nowrite-")
  try {
    const { ocMtimeAfterBootstrap } = await runTaskRouting(ctx, "brain")

    assert.ok(existsSync(ctx.tiersFile), "model-tiers.json exists")

    const afterOc = existsSync(ctx.ocConfig) ? statSync(ctx.ocConfig).mtimeMs : null
    assert.equal(afterOc, ocMtimeAfterBootstrap, "the tool.execute.before hook itself must never rewrite opencode.json mid-turn")
  } finally {
    ctx.cleanup()
  }
})

// ── Deescalation: a stale escalated route_path (from a prior Task delegation)
// must be reset by the NEXT turn's system.transform hook when that turn does
// not escalate — otherwise the footer icon/tier stays stuck at the last
// escalated depth forever, even after the orchestrator stops delegating.

test("deescalation: system.transform resets a stale escalated route_path back to cheap on a plain follow-up turn", async () => {
  const ctx = withSandbox("vibeos-tier-truth-deescalate-")
  try {
    writeTiers(ctx.tiersFile, null)
    writeFileSync(ctx.blackboxFile, JSON.stringify({ sessions: {} }))
    writeFileSync(join(ctx.vibeHome, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }))
    writeFileSync(ctx.ocConfig, JSON.stringify({ model: "test/cheap-model", plugin: ["vibeOS"] }, null, 2))

    const idx = await import("../src/index.js?tier-truth-deescalate-idx=" + Date.now())
    const hooks = await idx.DelegationEnforcer({ client: {}, directory: ctx.sandbox })

    const state = await import("../src/lib/state.js?tier-truth-deescalate-state=" + Date.now())
    const sid = state.getCurrentSessionId()

    // Simulate a PRIOR turn that escalated via Task delegation to brain — this is
    // exactly what tool-execute.ts's Task-routing block persists.
    const bbState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    bbState.sessions[sid] = {
      route_path: ["cheap", "medium", "brain"],
      pipeline_root: ["cheap", "medium", "brain"],
      cascade_depth: 3,
    }
    writeFileSync(ctx.blackboxFile, JSON.stringify(bbState))

    // A plain follow-up turn with no escalation signal (e.g. "good").
    await hooks["experimental.chat.system.transform"]({ message: { role: "user", content: "good" } }, { system: [] })

    const afterState = JSON.parse(readFileSync(ctx.blackboxFile, "utf8"))
    const afterSession = afterState.sessions[sid] || {}
    assert.deepEqual(afterSession.route_path, ["cheap"], "route_path must reset to the entry tier once the turn stops escalating")
    assert.equal(afterSession.cascade_depth, 1, "cascade_depth must deescalate back to 1")
  } finally {
    ctx.cleanup()
  }
})
