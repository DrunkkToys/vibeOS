// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { startFakeLlm } from "./helpers/fake-llm-server.mjs"
import { installVibeTierAgentsInConfig } from "../scripts/lib/vibe-tier-agents.mjs"

const REPO = resolve(import.meta.dirname, "..")
const BUNDLE = join(REPO, "dist/vibeOS.js")
const OPENCODE = process.env.VIBEOS_TEST_OPENCODE || "opencode"
const HAS_OPENCODE = spawnSync(OPENCODE, ["--version"], { encoding: "utf8" }).status === 0
const skip = !HAS_OPENCODE ? "opencode binary not installed" : !existsSync(BUNDLE) ? "dist/vibeOS.js not built" : false
const TRINITY = { cheap: { oc: "fake/cheap-m" }, medium: { oc: "fake/medium-m" }, brain: { oc: "fake/brain-m" } }
const FAILURE = "The tests failed:\n/work/x_test.cpp:12: error: 'ability' was not declared in this scope\nmake: *** [Makefile:8: test] Error 1\nPlease fix the code."

function rig(llm, mode) {
  const base = mkdtempSync(join(tmpdir(), "vibeos-real-oc-"))
  const proj = join(base, "proj"), home = join(base, "home"), vh = join(base, "vibe")
  for (const d of [proj, vh, join(home, ".config"), join(home, ".local/share")]) mkdirSync(d, { recursive: true })
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "fake/cheap-m",
    small_model: "fake/cheap-m",
    plugin: [BUNDLE],
    provider: { fake: { npm: "@ai-sdk/openai-compatible", name: "Fake", options: { baseURL: llm.url, apiKey: "x" }, models: { "cheap-m": { name: "cheap-m" }, "medium-m": { name: "medium-m" }, "brain-m": { name: "brain-m" } } } },
  }
  installVibeTierAgentsInConfig(config, { trinity: TRINITY })
  writeFileSync(join(proj, "opencode.json"), JSON.stringify(config, null, 2))
  writeFileSync(join(vh, "model-tiers.json"), JSON.stringify({ trinity: TRINITY, selection: { enabled: true, optimization_mode: mode, active_slot: "cheap", entry_slot: "cheap", slot_locked: false, axis_overrides: {}, setup_completed_at: "2026-11-01T00:00:00.000Z" } }))
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || join(process.env.HOME || home, ".cache"), VIBEOS_HOME: vh, VIBEOS_API_URL: "http://127.0.0.1:1", VIBEOS_MCP_PORT: "0", OPENCODE_DISABLE_AUTOUPDATE: "1" }
  for (const k of ["VIBEOS_ROUTER_ONLY", "VIBEOS_AGENT_GATE", "VIBEOS_CASCADE", "VIBEOS_TEST_CONTEXT", "VIBEOS_FAST_CI", "VIBEOS_UNINSTALLED_MARKER_DIR", "NODE_OPTIONS"]) delete env[k]
  const run = (args) => new Promise((done) => {
    const c = spawn(OPENCODE, args, { cwd: proj, env, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    c.stdout.on("data", (d) => { out += d })
    c.stderr.on("data", (d) => { err += d })
    const t = setTimeout(() => c.kill("SIGKILL"), 120000)
    c.on("close", (status) => { clearTimeout(t); done({ status, out, err }) })
  })
  const turn = async (text, sid) => {
    const r = await run(["run", "--dir", proj, "--format", "json", "--agent", "vibe", ...(sid ? ["-s", sid] : []), text])
    let id = sid
    for (const l of r.out.split("\n")) { try { const j = JSON.parse(l); if (j.sessionID) id = j.sessionID } catch {} }
    assert.equal(r.status, 0, r.err.slice(-2000))
    return id
  }
  const assistantModels = async (sid) => {
    const r = await run(["export", sid])
    const json = JSON.parse(r.out.slice(r.out.indexOf("{")))
    return json.messages.filter((m) => m.info.role === "assistant").map((m) => m.info.modelID)
  }
  return { turn, assistantModels, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

test("real opencode: a vibeultrax failure follow-up runs on the next tier, on the wire and in the session record", { skip, timeout: 400000 }, async () => {
  const llm = await startFakeLlm()
  const r = rig(llm, "vibeultrax")
  try {
    const sid = await r.turn("say ok")
    const first = llm.requests.length
    assert.ok(first > 0)
    assert.deepEqual([...new Set(llm.requests.map((q) => q.model))], ["cheap-m"])
    await r.turn(FAILURE, sid)
    assert.deepEqual([...new Set(llm.requests.slice(first).map((q) => q.model))], ["medium-m"])
    const second = llm.requests.length
    await r.turn(FAILURE, sid)
    assert.deepEqual([...new Set(llm.requests.slice(second).map((q) => q.model))], ["brain-m"])
    assert.deepEqual(await r.assistantModels(sid), ["cheap-m", "medium-m", "brain-m"])
  } finally {
    await llm.close()
    r.cleanup()
  }
})

test("real opencode: vibeqmax keeps the configured model on a failure follow-up", { skip, timeout: 400000 }, async () => {
  const llm = await startFakeLlm()
  const r = rig(llm, "vibeqmax")
  try {
    const sid = await r.turn("say ok")
    await r.turn(FAILURE, sid)
    assert.deepEqual([...new Set(llm.requests.map((q) => q.model))], ["cheap-m"])
  } finally {
    await llm.close()
    r.cleanup()
  }
})
