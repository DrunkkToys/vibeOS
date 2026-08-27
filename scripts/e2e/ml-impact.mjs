#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Live A/B: does the ML orchestrator actually improve output quality?
//
// Three arms, one real multi-turn opencode session each, identical seeded repo
// and identical prompts:
//
//   raw        --pure, no plugin, brain pinned          true baseline
//   vibeqmax   plugin on, envelope [brain]              scaffolding, ML inert
//   vibeultrax plugin on, envelope [cheap,medium,brain] scaffolding + ML routing
//
// vibeqmax vs vibeultrax is the ML test: same plugin, same gate, same enforcement,
// same TDD — only the routing envelope differs. A single-slot envelope makes
// clampSlotToEnvelope() a structural no-op, so this needs no code change to
// toggle ML on and off.
//
// Quality is scored by a suite the model never sees: it is copied in only after
// the session has ended. Cost is reported alongside and never folded into qscore.
//
// Usage:
//   node scripts/e2e/ml-impact.mjs --model <provider/model> [--k 1] [--arms raw,vibeqmax,vibeultrax]
//                                  [--out .ml-impact-out] [--turn-timeout 300000] [--seed s]

import { execFileSync, execSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { generateTask } from "./ml-task/generate.mjs"
import { gradeHidden, gradeVisible } from "./ml-task/grade.mjs"
import { TURNS } from "./ml-task/prompts.mjs"
import { ARM_DEFS, applyEfficiency, mean, scoreComponents, stdev, voidReason } from "./ml-task/score.mjs"
import { installVibeTierAgentsInConfig } from "../lib/vibe-tier-agents.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BUNDLE = join(ROOT, "dist", "vibeOS.js")
const OPENCODE = join(process.env.HOME || "", ".opencode", "bin", "opencode")

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const MODEL = flag("--model", process.env.ML_IMPACT_MODEL || "")
const K = Number(flag("--k", process.env.ML_IMPACT_K || "1"))
const OUT = flag("--out", join(ROOT, ".ml-impact-out"))
const SEED = flag("--seed", process.env.ML_IMPACT_SEED || "ml-impact-1")
const TURN_TIMEOUT = Number(flag("--turn-timeout", process.env.ML_IMPACT_TURN_TIMEOUT || "300000"))
const MOCK_PORT = Number(flag("--mock-port", process.env.ML_IMPACT_MOCK_PORT || "48123"))
const BASE_URL = `http://127.0.0.1:${MOCK_PORT}`
const RESUME = argv.includes("--resume")

// Distinct free tiers on one provider, so the same-provider chat.params override
// applies and a trial that fails to route is visible instead of masked.
const TIERS = {
  cheap: process.env.ML_IMPACT_CHEAP || "opencode/nemotron-3.5-lightning-free",
  medium: process.env.ML_IMPACT_MEDIUM || "opencode/mimo-v2.5-free",
  brain: process.env.ML_IMPACT_BRAIN || "opencode/nemotron-3-ultra-free",
}

const ARMS = flag("--arms", "raw,vibeqmax,vibeultrax").split(",").map((s) => s.trim()).filter((a) => ARM_DEFS[a])

if (!MODEL) { console.error("[ml-impact] FATAL: --model is required"); process.exit(1) }
if (!existsSync(OPENCODE)) { console.error(`[ml-impact] FATAL: opencode CLI not found at ${OPENCODE}`); process.exit(1) }
if (!existsSync(BUNDLE)) { console.error("[ml-impact] FATAL: build the bundle first (npm run build:bundle)"); process.exit(1) }

if (!RESUME) rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, "logs"), { recursive: true })
mkdirSync(join(OUT, "mockdata"), { recursive: true })
mkdirSync(join(OUT, "trials"), { recursive: true })

// ── mock backend ──
let mockProc = null
function startMock() {
  mockProc = spawn(process.execPath, [join(ROOT, "scripts", "e2e", "mock.mjs"), OUT, String(MOCK_PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
  })
  let tries = 0
  while (tries++ < 50) {
    try { execFileSync("curl", ["-s", `${BASE_URL}/health`], { timeout: 2000, stdio: "ignore" }); return } catch { execSync("sleep 0.2") }
  }
  throw new Error("[ml-impact] mock failed to start")
}
function stopMock() { if (mockProc) { try { mockProc.kill() } catch {} mockProc = null } }

// ── trial setup ──
function setupTrial(arm, index) {
  const name = `${arm}-${index}`
  const proj = join(OUT, "trials", name, "proj")
  const home = join(OUT, "trials", name, "home")
  const def = ARM_DEFS[arm]
  mkdirSync(proj, { recursive: true })
  mkdirSync(join(home, "quality-gate"), { recursive: true })
  mkdirSync(join(home, "session-events"), { recursive: true })
  generateTask(proj)

  const config = { $schema: "https://opencode.ai/config.json" }
  if (def.plugin) {
    config.plugin = [BUNDLE]
    installVibeTierAgentsInConfig(config, {
      trinity: { cheap: { oc: TIERS.cheap }, medium: { oc: TIERS.medium }, brain: { oc: TIERS.brain } },
    })
  }
  writeFileSync(join(proj, "opencode.json"), JSON.stringify(config, null, 2))

  if (def.plugin) {
    // No axis tier pin and no slot lock: either silently outranks the routed
    // decision, which would run two identical arms and report a false null.
    writeFileSync(join(home, "model-tiers.json"), JSON.stringify({
      trinity: { cheap: { oc: TIERS.cheap }, medium: { oc: TIERS.medium }, brain: { oc: TIERS.brain } },
      selection: {
        enabled: true,
        optimization_mode: def.mode,
        requested_optimization_mode: def.mode,
        active_pipeline: def.pipeline,
        active_slot: def.entry,
        entry_slot: def.entry,
        slot_locked: false,
        axis_overrides: {},
      },
    }, null, 2))
  }
  return { name, arm, index, proj, home }
}

// ── one turn ──
function runTurn(trial, turn, sessionId) {
  const def = ARM_DEFS[trial.arm]
  const env = {
    ...process.env,
    VIBEOS_HOME: trial.home,
    VIBEOS_API_URL: BASE_URL,
    VIBEOS_API_TOKEN: "vos_" + "a".repeat(64),
    VIBEOS_MCP_PORT: "0",
    VIBEOS_QUALITY_GATE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  }
  const args = ["run", "--dir", trial.proj, "--format", "json", "--auto", "-m", MODEL, "--agent", def.agent]
  if (def.pure) args.push("--pure")
  if (sessionId) args.push("-s", sessionId)
  args.push(turn.prompt)

  const started = Date.now()
  let res
  try {
    res = spawnSync(OPENCODE, args, { encoding: "utf8", timeout: TURN_TIMEOUT, maxBuffer: 128 * 1024 * 1024, env })
  } catch (e) {
    res = { stdout: e.stdout || "", stderr: e.stderr || "", status: e.status ?? -1 }
  }
  const elapsedMs = Date.now() - started
  const stdout = res.stdout || ""
  const stderr = res.stderr || ""
  writeFileSync(join(OUT, "logs", `${trial.name}-${turn.id}.log`), stdout + "\n===STDERR===\n" + stderr)

  let sid = sessionId
  const text = []
  for (const line of stdout.split("\n")) {
    let j = null
    try { j = JSON.parse(line) } catch { continue }
    if (!j) continue
    if (!sid && j.sessionID) sid = j.sessionID
    if (typeof j.text === "string") text.push(j.text)
    if (j.part && typeof j.part.text === "string") text.push(j.part.text)
  }
  return {
    id: turn.id,
    status: res.status ?? -1,
    timedOut: res.status === null || res.signal === "SIGTERM",
    elapsedMs,
    sessionId: sid,
    text: text.join("\n"),
    stdoutBytes: stdout.length,
  }
}

// ── evidence readers ──
function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
function collectEvidence(trial) {
  const audit = readJsonl(join(trial.home, "cascade-audit", "cascade-audit.jsonl"))
  const ledger = readJsonl(join(trial.home, "turn-ledger.jsonl"))
  const chatParams = audit.filter((r) => r.source === "chat-params")
  const slots = [...new Set(chatParams.map((r) => r.slot).filter(Boolean))]
  const modes = [...new Set(chatParams.map((r) => r.optimizationMode).filter(Boolean))]
  const overrides = chatParams.filter((r) => r.overridden).length
  const models = [...new Set(ledger.map((r) => r?.finalized?.finalVisibleModel).filter(Boolean))]
  const homeFiles = existsSync(trial.home) ? readdirSync(trial.home) : []
  return { auditRows: audit.length, chatParamsRows: chatParams.length, slots, modes, overrides, finalModels: models, homeFiles }
}

// ── scoring ──
function scoreTrial(trial, turns) {
  const visible = gradeVisible(trial.proj)
  const hidden = gradeHidden(trial.proj)
  const components = scoreComponents({ hidden, visible, turns, turnCount: TURNS.length })
  return {
    ...components,
    hidden: {
      groups: hidden.groups, passedGroups: hidden.passedGroups, groupRate: hidden.groupRate,
      assertions: hidden.assertions, assertionsPassed: hidden.assertionsPassed, assertionRate: hidden.assertionRate,
      per: Object.fromEntries(Object.entries(hidden.per).map(([k, v]) => [k, { ok: v.ok, pass: v.pass, fail: v.fail }])),
    },
    visible: { ok: visible.ok, pass: visible.pass, fail: visible.fail },
  }
}

// ── main ──
async function main() {
  startMock()
  const results = []
  console.log(`\n[ml-impact] model=${MODEL} arms=${ARMS.join(",")} k=${K} seed=${SEED} out=${OUT}`)
  console.log(`[ml-impact] tiers cheap=${TIERS.cheap} medium=${TIERS.medium} brain=${TIERS.brain}`)

  for (const arm of ARMS) {
    for (let i = 0; i < K; i++) {
      const trial = setupTrial(arm, i)
      console.log(`\n>>> ${trial.name}`)
      const turns = []
      let sid = null
      for (const turn of TURNS) {
        const t = runTurn(trial, turn, sid)
        sid = t.sessionId || sid
        turns.push(t)
        console.log(`    ${turn.id.padEnd(14)} status=${t.status} ${Math.round(t.elapsedMs / 1000)}s`)
        if (t.status !== 0) break
      }
      const ev = collectEvidence(trial)
      const reason = voidReason(arm, turns, ev)
      const record = {
        trial: trial.name, arm, index: i, sessionId: sid, evidence: ev,
        turns: turns.map(({ text, ...rest }) => ({ ...rest, textBytes: text.length })),
        void: reason || null,
      }
      if (reason) {
        console.log(`    VOID: ${reason}`)
      } else {
        record.score = scoreTrial(trial, turns)
        console.log(`    hidden ${record.score.hidden.passedGroups}/${record.score.hidden.groups} groups, ` +
          `${record.score.hidden.assertionsPassed}/${record.score.hidden.assertions} assertions`)
      }
      results.push(record)
      writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2))
    }
  }

  applyEfficiency(results)
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2))
  report(results)
  stopMock()
}


function report(results) {
  console.log("\n================ ML IMPACT ================")
  const rows = []
  for (const arm of ARMS) {
    const all = results.filter((r) => r.arm === arm)
    const ok = all.filter((r) => !r.void)
    const q = ok.map((r) => r.qscore)
    rows.push({
      arm, n: ok.length, voided: all.length - ok.length,
      qscore: mean(q), sd: stdev(q),
      correctness: mean(ok.map((r) => r.score.correctness)),
      honesty: mean(ok.map((r) => r.score.honesty)),
      wallS: mean(ok.map((r) => r.score.wallMs)) / 1000,
    })
  }
  console.log("arm         n  void  qscore   sd     correct  honest  wall(s)")
  for (const r of rows) {
    console.log(
      `${r.arm.padEnd(11)} ${String(r.n).padStart(1)}  ${String(r.voided).padStart(4)}  ` +
      `${r.qscore.toFixed(3)}   ${r.sd.toFixed(3)}  ${r.correctness.toFixed(3)}    ${r.honesty.toFixed(2)}    ${Math.round(r.wallS)}`,
    )
  }
  const q = Object.fromEntries(rows.map((r) => [r.arm, r]))
  if (q.vibeqmax && q.vibeultrax && q.vibeqmax.n && q.vibeultrax.n) {
    const claimed = 1.07
    const observed = q.vibeqmax.qscore > 0 ? q.vibeultrax.qscore / q.vibeqmax.qscore : 0
    const spread = (q.vibeqmax.sd + q.vibeultrax.sd) / 2
    console.log(`\nML effect (vibeultrax / vibeqmax): ${observed.toFixed(3)}x   claimed ${claimed}x`)
    console.log(`pooled sd ${spread.toFixed(3)} over n=${q.vibeultrax.n} — ` +
      (spread >= Math.abs(observed - 1) ? "the spread CANNOT distinguish the arms at this k" : "the difference exceeds the spread"))
  }
  console.log(`\nartifacts: ${OUT}/results.json`)
}

main().catch((e) => { stopMock(); console.error(e); process.exit(1) })
