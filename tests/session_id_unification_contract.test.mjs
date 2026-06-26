// SPDX-License-Identifier: MIT
// Locks PR #328 (Fix blackbox session-id fragmentation freezing all sessions at INIT).
//
// Before #328, chat-transform.ts, research-audit.ts, and index.ts each minted their
// own "opencode-<pid>-<Date.now()>" session id instead of reading the single memoized
// id from runtime-state.ts. The blackbox writer and reader ended up keying state under
// different ids, so session-scoped history/mode/scratchpad lookups never found what an
// earlier turn (or another module) had written, and every session stayed frozen at
// sub_regime: INIT. These tests prove each module's session-scoped lookups resolve
// against the SAME canonical id rather than passing by accident.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("syncControlSettings resolves the session-scoped optimization mode under the canonical session id", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-sid-unify-opt-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

    const { getOcSessionId } = await import("../src/lib/runtime-state.js?sid-unify-opt=" + Date.now())
    const sid = getOcSessionId()

    // Global mode is "budget" (single cheap tier) — distinct from the session-scoped
    // override below, so the assertion only passes if the session lookup actually
    // resolves under the canonical id rather than silently falling through to global.
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "budget",
        active_pipeline: ["medium"],
      },
      trinity: {
        cheap: { oc: "test/cheap" },
        medium: { oc: "test/medium" },
        brain: { oc: "test/brain" },
      },
    }))
    writeFileSync(join(process.env.VIBEOS_HOME, "blackbox-state.json"), JSON.stringify({
      sessions: {
        [`${sid}_opt`]: { optimization_mode: "vibeultrax" },
      },
    }))

    const mod = await import("../src/lib/hooks/chat-transform.js?sid-unify-opt=" + Date.now())
    mod.syncControlSettings({}, {
      authoritative: true,
      backendDecision: { source: "backend" },
    })

    const raw = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"))
    assert.deepEqual(
      raw.selection.active_pipeline,
      ["cheap", "medium", "brain"],
      "chat-transform's session-scoped mode lookup must key off the canonical getOcSessionId() value — if its own _OC_SID diverged, this would silently fall back to the global 'budget' mode and yield ['cheap']",
    )
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("researchAudit finds session-scoped fetch summaries written under the canonical session id", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-sid-unify-audit-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

    const { getOcSessionId } = await import("../src/lib/runtime-state.js?sid-unify-audit=" + Date.now())
    const sid = getOcSessionId()

    const scratchRoot = join(process.env.VIBEOS_HOME, "scratch")
    const sessionHashDir = join(scratchRoot, "sessions", sid, "by-hash")
    mkdirSync(sessionHashDir, { recursive: true })
    writeFileSync(join(sessionHashDir, "abc123.summary.txt"), "Source: https://example.com/page — fetched docs")

    writeFileSync(join(scratchRoot, "index.jsonl"), JSON.stringify({
      tool: "WebFetch",
      ts: new Date().toISOString(),
      hash: "abc123",
      size: 100,
    }) + "\n")

    const mod = await import("../src/lib/research-audit.js?sid-unify-audit=" + Date.now())
    const report = mod.researchAudit({ hours: 24 })

    assert.equal(
      report.byDomain["example.com"],
      1,
      "research-audit's _OC_SID must match the canonical session id so it finds the summary written under sessions/<sid>/by-hash — if its own id diverged, this fetch would be miscounted as 'unknown'",
    )
    assert.equal(report.byDomain.unknown || 0, 0)
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("recordSaving survives a session record pre-created with a partial shape (no warns/cache_hits)", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-sid-unify-saving-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

    const { getOcSessionId } = await import("../src/lib/runtime-state.js?sid-unify-saving=" + Date.now())
    const sid = getOcSessionId()

    // Mirrors what saveBlackboxVector/Outcome write before recordSaving ever runs:
    // a session record that exists but has no warns/cache_hits arrays yet.
    writeFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), JSON.stringify({
      sessions: { [sid]: { cv: { optimization_mode: "vibeultrax" } } },
    }))

    const mod = await import("../src/lib/index-helpers.js?sid-unify-saving=" + Date.now())
    assert.doesNotThrow(() => mod.recordSaving("bash", "partial-shape regression", 0.01))

    const raw = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "delegation-state.json"), "utf8"))
    const ses = raw.sessions[sid]
    assert.ok(Array.isArray(ses.warns) && ses.warns.length === 1, "warns must be initialized and recorded despite the partial pre-existing shape")
    assert.ok(Array.isArray(ses.cache_hits), "cache_hits must be initialized despite the partial pre-existing shape")
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})
