// SPDX-License-Identifier: MIT
// Contract: vibeOS only drives a turn when the `vibe` agent is selected in
// OpenCode's mode dropdown. With build/plan selected every automatic hook is a
// no-op — no footer, no system directives, no enforcement, no model override.
// Contract 2: once the uninstall marker exists, the already-loaded bundle's
// hooks go inert at runtime (not just at the next plugin load).

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const gate = await import("../src/lib/agent-gate.js")
const { resetUninstalledMarkerCache } = await import("../src/lib/runtime-config.js")
const { DelegationEnforcer } = await import("../src/index.js")

function freshGate() {
  gate.resetAgentGate()
  delete process.env.VIBEOS_AGENT_GATE
}

test("agent names: only vibe and its tier subagents pass", () => {
  freshGate()
  for (const name of ["vibe", "vibe-cheap", "vibe-medium", "vibe-brain", "VIBE"]) {
    assert.equal(gate.isVibeAgentName(name), true, name)
  }
  for (const name of ["build", "plan", "general", "", null, undefined, "vibes"]) {
    assert.equal(gate.isVibeAgentName(name), false, String(name))
  }
})

test("a session is gated by the agent OpenCode last reported for it", () => {
  freshGate()
  gate.recordSessionAgent("s-build", "build")
  gate.recordSessionAgent("s-vibe", "vibe")
  assert.equal(gate.isVibeAgentSession("s-build"), false)
  assert.equal(gate.isVibeAgentSession("s-vibe"), true)
  // Switching the dropdown mid-session flips the gate on the next turn.
  gate.recordSessionAgent("s-build", "vibe")
  assert.equal(gate.isVibeAgentSession("s-build"), true)
})

test("hosts that never report an agent keep vibeOS running", () => {
  freshGate()
  assert.equal(gate.isVibeAgentSession("unknown-session"), true)
})

test("an unseen session falls back to the last reported agent", () => {
  freshGate()
  gate.recordSessionAgent("s1", "plan")
  assert.equal(gate.isVibeAgentSession("never-seen"), false)
  gate.recordSessionAgent("s2", "vibe")
  assert.equal(gate.isVibeAgentSession("never-seen"), true)
})

test("VIBEOS_AGENT_GATE=off disables the gate entirely", () => {
  freshGate()
  gate.recordSessionAgent("s-build", "build")
  process.env.VIBEOS_AGENT_GATE = "off"
  try {
    assert.equal(gate.isVibeAgentSession("s-build"), true)
  } finally {
    delete process.env.VIBEOS_AGENT_GATE
  }
})

test("empty agent values never clobber a known session agent", () => {
  freshGate()
  gate.recordSessionAgent("s", "vibe")
  gate.recordSessionAgent("s", "")
  gate.recordSessionAgent("s", null)
  assert.equal(gate.getSessionAgent("s"), "vibe")
  assert.equal(gate.isVibeAgentSession("s"), true)
})

test("repeated recording of the same session does not grow unbounded", () => {
  freshGate()
  for (let i = 0; i < 500; i++) gate.recordSessionAgent("same-session", "vibe")
  assert.equal(gate.getSessionAgent("same-session"), "vibe")
  for (let i = 0; i < 500; i++) gate.recordSessionAgent(`s-${i}`, "vibe")
  assert.equal(gate.getSessionAgent("s-499"), "vibe")
  // Oldest entries are evicted; the gate still answers (via last-known agent).
  assert.equal(gate.isVibeAgentSession("s-0"), true)
})

async function loadPlugin(dir) {
  return DelegationEnforcer({ client: null, directory: dir })
}

test("hooks are inert while a non-vibe agent is selected", async () => {
  freshGate()
  const root = mkdtempSync(join(tmpdir(), "vibeos-gate-"))
  const prevHome = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = join(root, "state")
  try {
    const hooks = await loadPlugin(root)
    // OpenCode reports the selected agent on chat.params.
    await hooks["chat.params"]({ sessionID: "s-build", agent: "build" }, { options: {} })

    const system = { system: ["base prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "s-build" }, system)
    assert.deepEqual(system.system, ["base prompt"], "system prompt was modified under build agent")

    const textOut = { text: "hello" }
    await hooks["experimental.text.complete"]({ sessionID: "s-build" }, textOut)
    assert.equal(textOut.text, "hello", "footer was appended under build agent")

    const toolOut = { args: {} }
    await hooks["tool.execute.before"]({ tool: "write", sessionID: "s-build", callID: "c1" }, toolOut)
    assert.deepEqual(toolOut, { args: {} }, "enforcement fired under build agent")

    const env = { env: {} }
    await hooks["shell.env"]({ cwd: root, sessionID: "s-build" }, env)
    assert.deepEqual(env.env, {}, "shell env was injected under build agent")
  } finally {
    if (prevHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevHome
    freshGate()
    rmSync(root, { recursive: true, force: true })
  }
})

test("hooks run again once the vibe agent is selected", async () => {
  freshGate()
  const root = mkdtempSync(join(tmpdir(), "vibeos-gate-on-"))
  const prevHome = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = join(root, "state")
  try {
    const hooks = await loadPlugin(root)
    await hooks["chat.message"]({ sessionID: "s-vibe", agent: "vibe" })
    const env = { env: {} }
    await hooks["shell.env"]({ cwd: root, sessionID: "s-vibe" }, env)
    assert.ok(Object.keys(env.env).length > 0, "vibe agent must still get the runtime env")
  } finally {
    if (prevHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevHome
    freshGate()
    rmSync(root, { recursive: true, force: true })
  }
})

test("an in-session uninstall makes already-registered hooks inert", async () => {
  freshGate()
  const root = mkdtempSync(join(tmpdir(), "vibeos-gate-uninst-"))
  const markerDir = join(root, "marker")
  const prevHome = process.env.VIBEOS_HOME
  const prevMarker = process.env.VIBEOS_UNINSTALLED_MARKER_DIR
  process.env.VIBEOS_HOME = join(root, "state")
  process.env.VIBEOS_UNINSTALLED_MARKER_DIR = markerDir
  try {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(markerDir, { recursive: true })
    const hooks = await loadPlugin(root)
    await hooks["chat.message"]({ sessionID: "s-vibe", agent: "vibe" })

    // Uninstall happens mid-process: the bundle stays loaded, the marker lands.
    writeFileSync(join(markerDir, "vibeOS-uninstalled"), "x")
    resetUninstalledMarkerCache()

    const system = { system: ["base prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "s-vibe" }, system)
    assert.deepEqual(system.system, ["base prompt"], "system prompt modified after uninstall")

    const textOut = { text: "hello" }
    await hooks["experimental.text.complete"]({ sessionID: "s-vibe" }, textOut)
    assert.equal(textOut.text, "hello", "footer appended after uninstall")

    const env = { env: {} }
    await hooks["shell.env"]({ cwd: root, sessionID: "s-vibe" }, env)
    assert.deepEqual(env.env, {}, "env injected after uninstall")
  } finally {
    if (prevHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevHome
    if (prevMarker === undefined) delete process.env.VIBEOS_UNINSTALLED_MARKER_DIR
    else process.env.VIBEOS_UNINSTALLED_MARKER_DIR = prevMarker
    resetUninstalledMarkerCache()
    freshGate()
    rmSync(root, { recursive: true, force: true })
  }
})
