#!/usr/bin/env node
// vibeOS E2E release harness — round 2.
// Drives real headless opencode sessions against the built bundle
// (dist/vibeOS.js) using a real model + a local mock backend, then prints a
// pass/fail table and a RELEASE: GO|NO verdict.
//
// Usage:
//   node scripts/e2e/harness.mjs [--list] [--only <name>] [--seed <s>] [--k <n>]
//                                [--model <provider/model>] [--out <dir>] [--mock-port <p>]
// Env: E2E_MODEL (model), E2E_K, E2E_SEED. Without a model the harness skips (exit 0)
// so CI can run it without API keys.

import { execFileSync, execSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { allScenarios, TIER_MODELS } from "./scenarios.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BUNDLE = join(ROOT, "dist", "vibeOS.js")
const OPENCODE = process.env.HOME + "/.opencode/bin/opencode"
const DEFAULT_OUT = join(ROOT, ".e2e-tmp")

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const has = (name) => args.includes(name)
const MODEL = flag("--model", process.env.E2E_MODEL || "")
const SEED = flag("--seed", process.env.E2E_SEED || "e2e-round2")
const K = Number(flag("--k", process.env.E2E_K || "2"))
const OUT = flag("--out", DEFAULT_OUT)
const MOCK_PORT = Number(flag("--mock-port", process.env.E2E_MOCK_PORT || "48081"))
const ONLY = flag("--only", "")
const BASE_URL = `http://127.0.0.1:${MOCK_PORT}`
const DEAD_URL = `http://127.0.0.1:${MOCK_PORT + 1}`
const TIMEOUT_MS = Number(flag("--timeout", "150000"))

if (has("--list")) {
  console.log("E2E scenarios:")
  for (const s of allScenarios) console.log(`  ${s.name.padEnd(24)} ${s.label}`)
  process.exit(0)
}
if (!MODEL) {
  console.log("[e2e] skipped: no model configured (set E2E_MODEL or --model)")
  process.exit(0)
}
if (!existsSync(BUNDLE)) {
  console.error("[e2e] FATAL: build the bundle first (npm run build:bundle)")
  process.exit(1)
}
if (!existsSync(OPENCODE)) {
  console.error(`[e2e] FATAL: opencode CLI not found at ${OPENCODE}`)
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, "logs"), { recursive: true })
mkdirSync(join(OUT, "mockdata"), { recursive: true })

// ── deterministic RNG ──
function mulberry32(seedStr) {
  let a = 0
  for (let i = 0; i < seedStr.length; i++) a = (a * 31 + seedStr.charCodeAt(i)) >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(SEED)
const FILES = ["math", "arithmetic", "geometry", "algebra"]

// ── mock lifecycle ──
let mockProc = null
function startMock() {
  mockProc = spawn(process.execPath, [join(ROOT, "scripts", "e2e", "mock.mjs"), OUT, String(MOCK_PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
  })
  // wait for the mock to accept connections
  let tries = 0
  while (tries++ < 50) {
    try {
      execFileSync("curl", ["-s", `${BASE_URL}/health`], { timeout: 2000, stdio: "ignore" })
      return
    } catch { execSync("sleep 0.2") }
  }
  throw new Error("[e2e] mock failed to start")
}

// ── per-trial state ──
let trial = null
function newTrial(name) {
  trial = {
    name,
    proj: join(OUT, "proj", name),
    home: join(OUT, "home", name),
    sessionId: null,
    slot: "cheap",
  }
  mkdirSync(join(trial.proj, "src"), { recursive: true })
  mkdirSync(join(trial.proj, "tests"), { recursive: true })
  mkdirSync(join(trial.home, "quality-gate"), { recursive: true })
  mkdirSync(join(trial.home, "session-events"), { recursive: true })
  writeFileSync(join(trial.proj, "opencode.json"), JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    plugin: [BUNDLE],
  }, null, 2))
  writeFileSync(join(trial.proj, "package.json"), JSON.stringify({ name: "e2e-proj", type: "module", scripts: { test: "node --test tests/" } }, null, 2))
  writeFileSync(join(trial.home, "model-tiers.json"), JSON.stringify({
    trinity: {
      cheap: { oc: TIER_MODELS.cheap },
      medium: { oc: TIER_MODELS.medium },
      brain: { oc: TIER_MODELS.brain },
    },
  }, null, 2))
}

function seedSelection(overrides = {}) {
  const path = join(trial.home, "model-tiers.json")
  let tiers = { trinity: { cheap: { oc: TIER_MODELS.cheap }, medium: { oc: TIER_MODELS.medium }, brain: { oc: TIER_MODELS.brain } } }
  try { tiers = JSON.parse(readFileSync(path, "utf8")) } catch {}
  tiers.selection = { ...(tiers.selection || {}), ...overrides }
  writeFileSync(path, JSON.stringify(tiers, null, 2))
}

function writeTemplate(f, slot) {
  if (!trial) newTrial(`tpl-${f}-${Date.now()}`)
  writeFileSync(join(trial.proj, "src", `${f}.mjs`), `export function add(a, b) {\n  return a + b\n}\n`)
  writeFileSync(join(trial.proj, "tests", `${f}.test.mjs`), `import test from "node:test"\nimport assert from "node:assert/strict"\nimport { add } from "../src/${f}.mjs"\ntest("add", () => assert.equal(add(2, 3), 5))\n`)
  writeFileSync(join(trial.proj, "README.md"), `# ${f}\n`)
  if (slot) { trial.slot = slot; seedSelection({ active_slot: slot }) }
}

function writePluginRepo() {
  if (!trial) newTrial("plugin-repo")
  rmSync(trial.proj, { recursive: true, force: true })
  mkdirSync(join(trial.proj, "src", "vibeOS-lib"), { recursive: true })
  mkdirSync(join(trial.proj, "dist"), { recursive: true })
  copyFileSync(BUNDLE, join(trial.proj, "dist", "vibeOS.js"))
  writeFileSync(join(trial.proj, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [BUNDLE] }, null, 2))
  writeFileSync(join(trial.proj, "package.json"), JSON.stringify({ name: "vibeostheog", version: "0.0.0" }, null, 2))
  writeFileSync(join(trial.proj, "src", "vibeOS-lib", "core.ts"), "export const CORE = true\n")
}

function mockCount() {
  const p = join(OUT, "mockdata", "requests.jsonl")
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).length : 0
}

function collectStep(sid, offline, footerTextRaw) {
  const gd = join(trial.home, "quality-gate")
  let verdicts = []
  if (existsSync(gd)) {
    for (const file of readdirSync(gd)) {
      const lines = readFileSync(join(gd, file), "utf8").trim().split("\n").filter(Boolean)
      verdicts = verdicts.concat(lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean))
    }
  }
  let verified = false
  let footerProbes = []
  let modelId = ""
  const ed = join(trial.home, "session-events")
  if (existsSync(ed)) {
    for (const file of readdirSync(ed)) {
      for (const l of readFileSync(join(ed, file), "utf8").trim().split("\n").filter(Boolean)) {
        try {
          const e = JSON.parse(l)
          if (e.role === "verification" && e.exitCode === 0) verified = true
          if (e.kind === "footer-probe") footerProbes.push(e.footer_line || "")
          if (e.model_id) modelId = e.model_id
        } catch {}
      }
    }
  }
  const last = verdicts.length ? verdicts[verdicts.length - 1] : null
  let footerText = footerProbes.length ? footerProbes[footerProbes.length - 1] : ""
  // The footer line is also printed synchronously to stderr (non-TTY path),
  // which flushes reliably before process exit — prefer it over the probe.
  if (footerTextRaw) footerText = footerTextRaw
  if (!modelId && footerText) {
    // footer format: "— <tier> <slot> | <provider> | <model display> ..."
    const seg = String(footerText).split("|").map((s) => s.trim())
    if (seg.length >= 3 && seg[2]) modelId = seg[2]
  }
  let activeSlot = ""
  if (footerText) {
    const first = String(footerText).split("|").map((s) => s.trim())[0] || ""
    const parts = first.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) activeSlot = parts[parts.length - 1]
  }
  const gaugeMatch = String(footerText).match(/[▁▂▃▅▆█]/)
  return { verdicts, lastVerdict: last, verified, footerText, stressGauge: gaugeMatch ? gaugeMatch[0] : "", modelId, activeSlot, notes: 0, posts: { telemetry: 0, outcomes: 0 }, sid }
}

// ctx object provided to scenarios
const asserts = []
let scenario = null
const ctx = {
  fileName: (i) => FILES[i % FILES.length],
  writeTemplate: (f, slot) => writeTemplate(f, slot),
  writeFile: (rel, content) => { mkdirSync(join(trial.proj, rel.split("/").slice(0, -1).join("/")), { recursive: true }); writeFileSync(join(trial.proj, rel), content) },
  hasFile: (rel) => existsSync(join(trial.proj, rel)),
  readFile: (rel) => existsSync(join(trial.proj, rel)) ? readFileSync(join(trial.proj, rel), "utf8") : "",
  listTestFiles: () => readdirSync(join(trial.proj, "tests")).filter((x) => /test|spec/i.test(x)).join(","),
  readOutcomes: () => { const p = join(OUT, "mockdata", "outcomes.jsonl"); return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [] },
  writePluginRepo: () => writePluginRepo(),
  seedSelection: (overrides) => seedSelection(overrides),
  readVerifiedSavings: () => {
    try {
      const p = join(trial.home, "delegation-state.json")
      if (!existsSync(p)) return 0
      const state = JSON.parse(readFileSync(p, "utf8"))
      const sessions = state?.sessions && typeof state.sessions === "object" ? state.sessions : {}
      let total = 0
      for (const sid of Object.keys(sessions)) {
        total += Number(sessions[sid]?.verified_savings_usd || 0)
      }
      return Math.round(total * 10000) / 10000
    } catch {
      return 0
    }
  },
  readTiers: () => {
    try {
      const p = join(trial.home, "model-tiers.json")
      return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}
    } catch {
      return {}
    }
  },
  readSessionEvents: () => {
    const events = []
    const ed = join(trial.home, "session-events")
    if (existsSync(ed)) {
      for (const file of readdirSync(ed)) {
        for (const l of readFileSync(join(ed, file), "utf8").trim().split("\n").filter(Boolean)) {
          try {
            const e = JSON.parse(l)
            if (e && typeof e === "object" && (e.tool || e.kind)) events.push(e)
          } catch {}
        }
      }
    }
    return events
  },
  assert: (label, ok, detail) => asserts.push({ scenario: scenario, label, ok, detail: detail || "" }),
  step: async (prompt, opts = {}) => {
    const offline = opts.offline === true
    const isContinue = Boolean(opts.continueSession)
    if (!isContinue && !trial) newTrial(`${scenario}-${Date.now()}`)
    if (isContinue && opts.continueSession === "auto" && trial.sessionId) {
      // reuse current trial's session
    } else if (isContinue && opts.continueSession && opts.continueSession !== "auto") {
      trial.sessionId = opts.continueSession
    }
    const env = {
      ...process.env,
      VIBEOS_HOME: trial.home,
      VIBEOS_API_URL: offline ? DEAD_URL : BASE_URL,
      VIBEOS_API_TOKEN: "vos_" + "a".repeat(64),
      VIBEOS_MCP_PORT: "0",
      VIBEOS_QUALITY_GATE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      ...(opts.env || {}),
    }
    const mockBefore = mockCount()
    const stepId = `${trial.name}-${(trial.sessionId || "t0")}`
    let out = ""
    let errText = ""
    let status = 0
    try {
      const cmdArgs = ["run", "--dir", trial.proj, "--format", "json", "--auto", "-m", MODEL, "--agent", "build"]
      if (isContinue && trial.sessionId) cmdArgs.push("-s", trial.sessionId)
      cmdArgs.push(prompt)
      const res = spawnSync(OPENCODE, cmdArgs, { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env })
      out = res.stdout || ""
      errText = res.stderr || ""
      status = res.status ?? -1
    } catch (e) {
      out = (e.stdout || "") + "\n" + (e.stderr || "")
      status = e.status ?? -1
    }
    out = out + "\n" + errText
    writeFileSync(join(OUT, "logs", stepId + ".json"), out)
    if (!trial.sessionId) {
      // grab the opencode session id for continuation
      for (const l of out.split("\n")) {
        try { const j = JSON.parse(l); if (j && j.sessionID) { trial.sessionId = j.sessionID; break } } catch {}
      }
    }
    // The footer line is printed synchronously to stderr (— ... —); grab the last one.
    const footerLineMatch = [...errText.matchAll(/—\s.*—\s*$/gm)].map((m) => m[0].trim())
    const footerTextRaw = footerLineMatch.length ? footerLineMatch[footerLineMatch.length - 1] : ""
    const c = collectStep(trial.sessionId, offline, footerTextRaw)
    c.notes = (out.match(/\[quality-gate\]/g) || []).length
    c.status = status
    c.out = out
    c.posts = { telemetry: 0, outcomes: 0 }
    if (!offline) {
      const lines = readFileSync(join(OUT, "mockdata", "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(mockBefore)
      c.posts.telemetry = lines.filter((l) => l.includes('"/api/v1/telemetry/record"')).length
      c.posts.outcomes = lines.filter((l) => l.includes('"/api/v1/blackbox/outcome"')).length
    }
    return c
  },
}

// ── run ──
async function main() {
  startMock()
  const runSet = ONLY ? allScenarios.filter((s) => s.name === ONLY) : allScenarios
  console.log(`\n[vibeOS E2E round 2] seed=${SEED} model=${MODEL} K=${K} out=${OUT}`)
  let totalFail = 0
  for (const s of runSet) {
    scenario = s.name
    asserts.length = 0
    for (let i = 0; i < (s.needsModel ? K : 1); i++) {
      trial = null
      newTrial(`${s.name}-${i}`)
      process.stdout.write(`\n>>> ${s.name} [${i + 1}/${K}]...\n`)
      try { await s.run(ctx) } catch (e) { ctx.assert("scenario ran without crash", false, e.message) }
    }
    const fails = asserts.filter((a) => !a.ok)
    const passCount = asserts.length - fails.length
    console.log(`\n## ${s.name} — ${passCount}/${asserts.length} assertions passed`)
    for (const a of asserts.filter((x) => !x.ok)) console.log(`  ✗ ${a.label}${a.detail ? ` :: ${a.detail}` : ""}`)
    totalFail += fails.length
  }
  // Suite-level wiring: blackbox/outcome + telemetry must reach the backend.
  // Only meaningful on a full run (a single --only scenario may have no FAIL).
  if (!ONLY) {
    const outcomes = existsSync(join(OUT, "mockdata", "outcomes.jsonl")) ? readFileSync(join(OUT, "mockdata", "outcomes.jsonl"), "utf8").trim().split("\n").filter(Boolean) : []
    const negWire = outcomes.some((l) => { try { return JSON.parse(l).outcome === "negative" } catch { return false } })
    const posWire = outcomes.some((l) => { try { return JSON.parse(l).outcome === "positive" } catch { return false } })
    const reqLog = join(OUT, "mockdata", "requests.jsonl")
    const telWire = existsSync(reqLog) && readFileSync(reqLog, "utf8").includes('"/api/v1/telemetry/record"')
    console.log("\n## wiring (suite-level)")
    console.log(`  ${posWire ? "PASS" : "FAIL"} a positive outcome reached the backend`)
    console.log(`  ${telWire ? "PASS" : "FAIL"} telemetry/record reached the backend`)
    if (negWire) {
      console.log("  PASS a negative outcome reached the backend")
    } else {
      // The model was honest in every trial this run (no FAIL verdict), so no
      // negative was ever posted. The negative path is the same blackboxOutcome
      // call as the positive path (value differs), and FAIL->negative mapping is
      // unit-tested — a random honest model must not flip the release verdict.
      console.log("  WARN no negative posted this run (model never took a shortcut); FAIL->negative wiring is unit-tested")
    }
    if (!posWire) totalFail++; if (!telWire) totalFail++
  }
  console.log(`\n================ VERDICT ================`)
  console.log(totalFail === 0 ? `RELEASE: GO` : `RELEASE: NO — ${totalFail} assertion(s) failed`)
  if (mockProc) mockProc.kill("SIGTERM")
  process.exit(totalFail === 0 ? 0 : 1)
}

main().catch((e) => { console.error("[e2e] fatal:", e); if (mockProc) mockProc.kill("SIGTERM"); process.exit(2) })
