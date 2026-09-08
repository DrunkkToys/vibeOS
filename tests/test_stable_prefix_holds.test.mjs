// SPDX-License-Identifier: MIT
// Contract: the cached prefix must not move.
//
// Measured in run20, both arms on the identical model: vibeultrax paid 231,254
// uncached input tokens against raw's 72,684, and read 21% LESS cache, with
// VIBEOS_STABLE_PREFIX=1 already on. Two defects in the prefix explain it.
//
// 1. `[project guard: CRITICAL]` was pushed into `output.system` on
//    `_turnCountInject % 5 === 0`, and pushed at position 0 -- AHEAD of the
//    three anti-fabrication constants whose own comment calls them
//    "byte-identical every turn". Probed on this tree before the fix, turns
//    2,3,4,6,7 emitted the same 5-entry prefix and turn 5 emitted 6 entries with
//    a 198-char guard prepended. Prefix caching matches from the front, so that
//    one insertion invalidated all five stable entries and every message behind
//    them -- on the turn it appeared and again on the turn it vanished.
//
// 2. `trinity` and `vibe` registered the SAME 2314-char description, so it was
//    sent twice on every single request.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-stable-prefix-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
const prevStable = process.env.VIBEOS_STABLE_PREFIX

process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
  model: "testprov/brain",
  plugin: ["vibeOS"],
}))
writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "cheap",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
  },
  trinity: {
    brain: { oc: "testprov/brain" },
    medium: { oc: "testprov/medium" },
    cheap: { oc: "testprov/cheap" },
  },
}))

const GUARD = "[project guard"

function freshInput() {
  return { messages: [{ parts: [{ type: "text", text: "keep going" }] }] }
}

function volatileText(input) {
  const last = input.messages[input.messages.length - 1]
  return (last.parts || [])
    .filter((p) => p?.type === "text")
    .map((p) => String(p.text || ""))
    .join("\n")
}

test("the system prefix is byte-identical on every turn once it has settled", async () => {
  process.env.VIBEOS_STABLE_PREFIX = "1"
  const chatTransform = await import("../src/lib/hooks/chat-transform.js")

  const turns = []
  for (let i = 0; i < 7; i++) {
    const input = freshInput()
    const output = { system: [] }
    await chatTransform.onSystemTransform(input, output)
    turns.push({ system: output.system.map(String), volatile: volatileText(input) })
  }

  // Turn 1 legitimately carries one-shot content (the welcome directive), so the
  // prefix is compared from turn 2 on -- that is where it must never move again.
  const settled = JSON.stringify(turns[1].system)
  for (let i = 2; i < turns.length; i++) {
    assert.equal(
      JSON.stringify(turns[i].system),
      settled,
      `turn ${i + 1} changed the cached system prefix:\n` +
        `  turn 2: ${JSON.stringify(turns[1].system.map((s) => s.slice(0, 48)))}\n` +
        `  turn ${i + 1}: ${JSON.stringify(turns[i].system.map((s) => s.slice(0, 48)))}`,
    )
  }

  for (let i = 0; i < turns.length; i++) {
    assert.ok(
      !turns[i].system.some((entry) => entry.includes(GUARD)),
      `turn ${i + 1} put the periodic project guard in the cached system prefix`,
    )
  }

  // It must still reach the model -- moving it out of `system` is only correct
  // if it lands as turn state on the last message instead.
  assert.ok(
    turns.some((t) => t.volatile.includes(GUARD)),
    "the project guard never reached the model on any of the 7 turns",
  )
})

test("with the stable prefix off, the project guard still goes into system", async () => {
  delete process.env.VIBEOS_STABLE_PREFIX
  const chatTransform = await import("../src/lib/hooks/chat-transform.js")

  let seen = false
  for (let i = 0; i < 6 && !seen; i++) {
    const output = { system: [] }
    await chatTransform.onSystemTransform(freshInput(), output)
    seen = output.system.map(String).some((entry) => entry.includes(GUARD))
  }
  assert.ok(seen, "default (non-stable-prefix) behaviour must be unchanged")
})

test("the trinity tool schema is sent once per request, not twice", async () => {
  const { DelegationEnforcer } = await import("../src/index.js")
  const hooks = await DelegationEnforcer({ client: {}, directory: join(sandbox, "proj") })

  const marker = "Use action='rebuild'"
  const full = Object.entries(hooks.tool)
    .filter(([, spec]) => String(spec?.description || "").includes(marker))
    .map(([name]) => name)
  assert.deepEqual(full, ["vibe"], "the full trinity schema must be registered under exactly one tool name")

  const alias = String(hooks.tool.trinity?.description || "")
  assert.ok(alias.length > 0, "the legacy `trinity` name must stay registered")
  assert.ok(alias.length < 300, `the legacy alias must not repeat the full schema (got ${alias.length} chars)`)
  assert.ok(alias.includes("vibe"), "the alias must point at the canonical tool name")
})

test("both tool names still execute", async () => {
  const { DelegationEnforcer } = await import("../src/index.js")
  const hooks = await DelegationEnforcer({ client: {}, directory: join(sandbox, "proj") })
  for (const name of ["vibe", "trinity"]) {
    const out = String(await hooks.tool[name].execute({ action: "status" }))
    assert.ok(out.length > 0, `${name} must still answer`)
  }
})

test("cleanup", async () => {
  try {
    const stateModule = await import("../src/lib/state.js")
    stateModule._flushLedgerBuffer()
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevVibeHome
    if (prevStable === undefined) delete process.env.VIBEOS_STABLE_PREFIX
    else process.env.VIBEOS_STABLE_PREFIX = prevStable
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
