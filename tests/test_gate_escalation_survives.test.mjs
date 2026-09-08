// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The quality gate judges the model's actual answer against real tool evidence.
// The cascade's own escalation is pre-hoc: it guesses from the prompt and cannot
// tell a good cheap answer from a bad one. So when the two disagree, the
// answer-derived verdict has to win -- and until now it did not. The gate wrote
// selection.active_slot and nothing else, so the next turn's syncControlSettings
// read an unchanged session slot, took the reconcile branch, and put the live
// model straight back on the tier the gate had just rejected.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function sandbox({ slotLocked = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-gate-esc-"))
  process.env.HOME = dir
  process.env.VIBEOS_HOME = join(dir, ".claude")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(dir, ".opencode"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "opencode.json"), JSON.stringify({ plugin: ["vibeOS"] }, null, 2))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: slotLocked,
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
    },
    trinity: {
      cheap: { oc: "opencode/big-pickle" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      brain: { oc: "deepseek/deepseek-v4-flash" },
    },
  }, null, 2))
  return dir
}

function sessionRecord(sid) {
  const f = join(process.env.VIBEOS_HOME, "blackbox-state.json")
  try { return JSON.parse(readFileSync(f, "utf-8"))?.sessions?.[sid] || null } catch { return null }
}

const FAILED_VERDICT = { passed: false, flow: "code", failures: [{ rule: "tests-claimed-not-run" }] }

// The prompt-derived choice: vibeultrax always re-enters the cascade at cheap.
const ENTERS_AT_CHEAP = {
  optimization_mode: "vibeultrax",
  tier_bias: "cheap",
  selected_slot: "cheap",
  route_path: ["cheap", "medium", "brain"],
  cascade_root: ["cheap", "medium", "brain"],
}

async function loadModules(tag, sid) {
  const sel = await import("../src/lib/selection-manager.js")
  const state = await import("../src/lib/state.js")
  state.setCurrentSessionId(sid)
  const ct = await import("../src/lib/hooks/chat-transform.js")
  return { sel, ct }
}

test("a gate escalation is recorded as the session's slot, not only as a selection write", async () => {
  const dir = sandbox()
  const tag = "gate-a=" + Date.now()
  const sid = "ses-gate-a"
  const { sel } = await loadModules(tag, sid)
  const idx = await import("../src/index.js?" + tag)

  idx._escalateOnGateFailureForTest(FAILED_VERDICT, sel.loadSelection(), sid)

  assert.equal(sel.loadSelection().active_slot, "medium", "the gate escalates one rung")
  assert.equal(sel.loadSessionSlot(sid), "medium", "and the session must carry it into the next turn")
  assert.equal(sel.loadPendingGateEscalation(sid), "medium", "a one-shot marker says this came from the answer")
  assert.ok(dir)
})

test("the next turn keeps the escalated tier instead of re-entering at cheap", async () => {
  sandbox()
  const tag = "gate-b=" + Date.now()
  const sid = "ses-gate-b"
  const { sel, ct } = await loadModules(tag, sid)
  const idx = await import("../src/index.js?" + tag)

  idx._escalateOnGateFailureForTest(FAILED_VERDICT, sel.loadSelection(), sid)
  const out = ct.syncControlSettings(ENTERS_AT_CHEAP, { authoritative: true })

  assert.equal(sel.loadSelection().active_slot, "medium", "the prompt asked for cheap; the answer said medium")
  assert.equal(sel.loadSessionSlot(sid), "medium")
  assert.ok(out)
})

test("the escalation is one-shot, so the cascade can still come back down", async () => {
  sandbox()
  const tag = "gate-c=" + Date.now()
  const sid = "ses-gate-c"
  const { sel, ct } = await loadModules(tag, sid)
  const idx = await import("../src/index.js?" + tag)

  idx._escalateOnGateFailureForTest(FAILED_VERDICT, sel.loadSelection(), sid)
  ct.syncControlSettings(ENTERS_AT_CHEAP, { authoritative: true })
  assert.equal(sel.loadPendingGateEscalation(sid), null, "consumed")

  // Second turn, no new gate failure: nothing pins the tier any more.
  ct.syncControlSettings(ENTERS_AT_CHEAP, { authoritative: true })
  assert.equal(sel.loadSessionSlot(sid), "cheap", "de-escalation still works, or there are no savings")
})

test("slot_locked still blocks the gate -- `vibe lock on` is a promise", async () => {
  sandbox({ slotLocked: true })
  const tag = "gate-d=" + Date.now()
  const sid = "ses-gate-d"
  const { sel } = await loadModules(tag, sid)
  const idx = await import("../src/index.js?" + tag)

  idx._escalateOnGateFailureForTest(FAILED_VERDICT, sel.loadSelection(), sid)

  assert.equal(sel.loadSelection().active_slot, "cheap", "locked means locked")
  assert.equal(sel.loadPendingGateEscalation(sid), null)
})

test("a passing verdict escalates nothing", async () => {
  sandbox()
  const tag = "gate-e=" + Date.now()
  const sid = "ses-gate-e"
  const { sel } = await loadModules(tag, sid)
  const idx = await import("../src/index.js?" + tag)

  idx._escalateOnGateFailureForTest({ passed: true, flow: "code", failures: [] }, sel.loadSelection(), sid)

  assert.equal(sel.loadSelection().active_slot, "cheap")
  assert.equal(sel.loadPendingGateEscalation(sid), null)
})
