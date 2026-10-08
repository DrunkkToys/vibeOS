#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { cliModelArgs, entryModel, retryDecision, voidReason } from "../ml-task/score.mjs"
import { readExecution } from "../ml-task/execution.mjs"
import { readBundleProvenance } from "../ml-task/provenance.mjs"
import { hashTree, treeChangedBetween } from "../ml-task/tree-hash.mjs"
import { installVibeTierAgentsInConfig } from "../../lib/vibe-tier-agents.mjs"
import { ARMS, TURNS, armTiers, gradeTask, loadTasks, budgetLeft, selectSubset, sessionTokens, strongShare, writeTask } from "./tasks.mjs"
import { pairedBootstrap, passRate, signTest } from "./stats.mjs"
import { gradeExercise, loadPolyglot, turnsForExercise, writeExercise } from "./polyglot.mjs"

const ROOT = fileURLToPath(new URL("../../..", import.meta.url))
const BUNDLE = join(ROOT, "dist", "vibeOS.js")
const OPENCODE = join(process.env.HOME || "", ".opencode", "bin", "opencode")

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const SUITE = flag("--suite", "humaneval")
const DATA = resolve(flag("--data", SUITE === "polyglot" ? "" : join(ROOT, "..", "theog-frontier-extract", "evaluation", "humaneval", "HumanEval.jsonl.gz")))
const SPLIT = flag("--split", "dev")
const LANGUAGE = flag("--language", "python")
const SEED = flag("--seed", "codebench-1")
const K = Number(flag("--k", "2"))
const OUT = resolve(ROOT, flag("--out", join(ROOT, ".codebench-out")))
const TURN_TIMEOUT = Number(flag("--turn-timeout", "900000"))
const LIMIT = Number(flag("--limit", "0"))
const MODELS = { weak: flag("--weak", ""), strong: flag("--strong", "") }
const ARM_LIST = flag("--arms", "raw-weak,raw-strong,cascade").split(",").map((s) => s.trim()).filter((a) => ARMS[a])
const RESUME = argv.includes("--resume")
const BUDGET_TOKENS = Number(flag("--budget-tokens", "0"))

if (!MODELS.weak || !MODELS.strong) { console.error("[codebench] FATAL: --weak and --strong are required"); process.exit(1) }
if (!["humaneval", "polyglot"].includes(SUITE)) { console.error("[codebench] FATAL: --suite must be humaneval or polyglot"); process.exit(1) }
if (!["dev", "holdout"].includes(SPLIT)) { console.error("[codebench] FATAL: --split must be dev or holdout"); process.exit(1) }
if (!existsSync(DATA)) { console.error(`[codebench] FATAL: no dataset at ${DATA}`); process.exit(1) }
if (!existsSync(OPENCODE)) { console.error(`[codebench] FATAL: opencode CLI not found at ${OPENCODE}`); process.exit(1) }
if (!existsSync(BUNDLE)) { console.error("[codebench] FATAL: build the bundle first (npm run build:bundle)"); process.exit(1) }

if (!RESUME) rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, "logs"), { recursive: true })
mkdirSync(join(OUT, "trials"), { recursive: true })

const ALL = SUITE === "polyglot" ? loadPolyglot(DATA, { language: LANGUAGE }) : loadTasks(DATA)
const write = SUITE === "polyglot" ? writeExercise : writeTask
const grade = SUITE === "polyglot" ? gradeExercise : gradeTask
const turnsFor = SUITE === "polyglot" ? turnsForExercise : () => TURNS
const SUBSET = selectSubset(ALL, { n: Math.min(30, ALL.length), seed: SEED })
const IDS = LIMIT ? SUBSET[SPLIT].slice(0, LIMIT) : SUBSET[SPLIT]
const TASKS = IDS.map((id) => ALL.find((t) => t.task_id === id))

function setupTrial(arm, task, index) {
  const name = `${arm}-${task.task_id.replace(/\W+/g, "_")}-${index}`
  const proj = join(OUT, "trials", name, "proj")
  const home = join(OUT, "trials", name, "home")
  rmSync(join(OUT, "trials", name), { recursive: true, force: true })
  mkdirSync(proj, { recursive: true })
  mkdirSync(home, { recursive: true })
  const { def } = ARMS[arm]
  const { model, tiers } = armTiers(arm, MODELS)
  write(proj, task)
  const config = { $schema: "https://opencode.ai/config.json" }
  if (def.plugin) {
    config.model = entryModel(def, tiers, model)
    config.plugin = [BUNDLE]
    installVibeTierAgentsInConfig(config, { trinity: { cheap: { oc: tiers.cheap }, medium: { oc: tiers.medium }, brain: { oc: tiers.brain } } })
    writeFileSync(join(home, "model-tiers.json"), JSON.stringify({
      trinity: { cheap: { oc: tiers.cheap }, medium: { oc: tiers.medium }, brain: { oc: tiers.brain } },
      selection: { enabled: true, optimization_mode: def.mode, requested_optimization_mode: def.mode, active_pipeline: def.pipeline, active_slot: def.entry, entry_slot: def.entry, slot_locked: false, axis_overrides: {} },
    }, null, 2))
  }
  writeFileSync(join(proj, "opencode.json"), JSON.stringify(config, null, 2))
  return { name, arm, task, index, proj, home, def, model }
}

function runTurn(trial, turn, sessionId) {
  const realHome = process.env.HOME || ""
  const isoHome = join(trial.home, "oc-home")
  mkdirSync(isoHome, { recursive: true })
  const env = {
    ...process.env,
    HOME: isoHome,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME || join(realHome, ".local", "share"),
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || join(realHome, ".config"),
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || join(realHome, ".cache"),
    VIBEOS_HOME: trial.home,
    VIBEOS_API_URL: "http://127.0.0.1:1",
    VIBEOS_API_TOKEN: "vos_" + "a".repeat(64),
    VIBEOS_MCP_PORT: "0",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    ...(trial.def.env || {}),
  }
  const args = ["run", "--dir", trial.proj, "--format", "json", "--auto", ...cliModelArgs(trial.def, trial.model), "--agent", trial.def.agent]
  if (trial.def.pure) args.push("--pure")
  if (sessionId) args.push("-s", sessionId)
  args.push(turn.prompt)
  const started = Date.now()
  const outPath = join(OUT, "logs", `${trial.name}-${turn.id}.stdout`)
  const errPath = join(OUT, "logs", `${trial.name}-${turn.id}.stderr`)
  let res
  let outFd = null
  let errFd = null
  try {
    outFd = openSync(outPath, "w")
    errFd = openSync(errPath, "w")
    res = spawnSync(OPENCODE, args, { timeout: TURN_TIMEOUT, killSignal: "SIGKILL", stdio: ["ignore", outFd, errFd], env })
  } catch (e) {
    res = { status: e.status ?? -1 }
  } finally {
    for (const fd of [outFd, errFd]) { if (fd !== null) { try { closeSync(fd) } catch {} } }
  }
  const stdout = existsSync(outPath) ? readFileSync(outPath, "utf8") : ""
  const stderr = existsSync(errPath) ? readFileSync(errPath, "utf8") : ""
  let sid = sessionId
  let toolCalls = 0
  const errors = []
  for (const line of stdout.split("\n")) {
    let j = null
    try { j = JSON.parse(line) } catch { continue }
    if (!j) continue
    if (!sid && j.sessionID) sid = j.sessionID
    if (j.type === "tool_use") toolCalls++
    if (j.type === "error") errors.push(JSON.stringify(j.error || {}))
  }
  return {
    id: turn.id,
    status: res.status ?? -1,
    timedOut: res.status === null || res.signal === "SIGKILL" || res.signal === "SIGTERM",
    elapsedMs: Date.now() - started,
    sessionId: sid,
    toolCalls,
    mutatingCalls: toolCalls,
    errorText: errors.join(" | ") + " " + stderr,
  }
}

function runTurnWithRetry(trial, turn, sessionId) {
  for (let attempt = 0; ; attempt++) {
    const before = hashTree(trial.proj)
    const result = runTurn(trial, turn, sessionId)
    result.treeChanged = treeChangedBetween(before, hashTree(trial.proj))
    result.attempts = attempt + 1
    const decision = retryDecision(result, attempt)
    if (!decision.retry) return result
    console.log(`    ${turn.id.padEnd(10)} ${decision.reason}, retrying in ${decision.waitMs / 1000}s`)
    execSync(`sleep ${decision.waitMs / 1000}`)
  }
}

function readCascadeLevel(home) {
  try { return JSON.parse(readFileSync(join(home, "cascade-state.json"), "utf8")) } catch { return null }
}

function byArm(results) {
  const out = {}
  for (const r of results) {
    if (r.void) continue
    out[r.arm] ||= {}
    ;(out[r.arm][r.task] ||= []).push(r.pass ? 1 : 0)
  }
  return out
}

function report(results) {
  const arms = byArm(results)
  const lines = ["", `================ CODEBENCH ${SUITE} (${SPLIT}, seed ${SEED}) ================`, "arm          trials  void  pass-rate  strong-share  wall(s)"]
  for (const arm of ARM_LIST) {
    const all = results.filter((r) => r.arm === arm)
    const ok = all.filter((r) => !r.void)
    const shares = ok.map((r) => r.strongShare).filter((x) => typeof x === "number")
    const share = shares.length ? (shares.reduce((a, b) => a + b, 0) / shares.length).toFixed(2) : "n/a"
    const wall = ok.length ? Math.round(ok.reduce((s, r) => s + r.wallMs, 0) / ok.length / 1000) : 0
    lines.push(`${arm.padEnd(12)} ${String(ok.length).padStart(6)}  ${String(all.length - ok.length).padStart(4)}  ${passRate(arms[arm] || {}).toFixed(3).padStart(9)}  ${String(share).padStart(12)}  ${String(wall).padStart(7)}`)
  }
  const cmp = (a, b) => {
    if (!arms[a] || !arms[b]) return
    const bs = pairedBootstrap(arms[a], arms[b], { iterations: 10000, seed: 1 })
    const st = signTest(arms[a], arms[b])
    lines.push(`${a} - ${b}: diff ${bs.diff.toFixed(3)}  95% CI [${bs.lo.toFixed(3)}, ${bs.hi.toFixed(3)}]  n=${bs.n}  sign ${st.aOnly}:${st.bOnly} p=${st.p}`)
  }
  lines.push("")
  cmp("raw-strong", "raw-weak")
  cmp("cascade", "raw-strong")
  cmp("cascade", "raw-weak")
  if (arms["raw-strong"] && arms["raw-weak"]) {
    const g = pairedBootstrap(arms["raw-strong"], arms["raw-weak"], { iterations: 10000, seed: 1 })
    lines.push(`Gate 1 (strong vs weak CI excludes 0): ${g.lo > 0 || g.hi < 0 ? "PASS" : "FAIL"}`)
  }
  const text = lines.join("\n")
  console.log(text)
  writeFileSync(join(OUT, "report.txt"), text + "\n")
}

function main() {
  const resultsPath = join(OUT, "results.json")
  const results = RESUME && existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : []
  const done = new Set(results.map((r) => r.trial))
  const provenance = readBundleProvenance(BUNDLE)
  writeFileSync(join(OUT, "provenance.json"), JSON.stringify({ ...provenance, suite: SUITE, language: SUITE === "polyglot" ? LANGUAGE : null, data: DATA, split: SPLIT, seed: SEED, tasks: IDS, models: MODELS }, null, 2))
  console.log(`[codebench] suite=${SUITE}${SUITE === "polyglot" ? `/${LANGUAGE}` : ""} split=${SPLIT} tasks=${IDS.length} k=${K} arms=${ARM_LIST.join(",")} weak=${MODELS.weak} strong=${MODELS.strong}`)
  console.log(`[codebench] bundle ${(provenance.sha256 || provenance.error || "?").slice(0, 12)} commit=${(provenance.commit || "none").slice(0, 8)}${provenance.dirty ? " DIRTY" : ""}`)
  run: for (let i = 0; i < K; i++) {
    for (const task of TASKS) {
      for (const arm of ARM_LIST) {
        if (done.has(`${arm}-${task.task_id.replace(/\W+/g, "_")}-${i}`)) continue
        const budget = budgetLeft(results, BUDGET_TOKENS)
        if (budget.stop) {
          console.log(`[codebench] STOP: token budget reached, ${budget.spent} of ${BUDGET_TOKENS} tokens spent`)
          break run
        }
        const trial = setupTrial(arm, task, i)
        const turns = []
        let sid = null
        for (const turn of turnsFor(task)) {
          const t = runTurnWithRetry(trial, turn, sid)
          sid = t.sessionId || sid
          turns.push(t)
          if (t.status !== 0) break
        }
        const homeFiles = existsSync(trial.home) ? readdirSync(trial.home).filter((f) => f !== "oc-home") : []
        const execution = readExecution(sid)
        const reason = voidReason(trial.def === ARMS.cascade.def ? "cascade" : "raw", turns, { homeFiles }, execution)
        const record = {
          trial: trial.name, arm, task: task.task_id, index: i, sessionId: sid,
          turns: turns.map((t) => ({ id: t.id, status: t.status, elapsedMs: t.elapsedMs, toolCalls: t.toolCalls, attempts: t.attempts })),
          wallMs: turns.reduce((s, t) => s + t.elapsedMs, 0),
          models: execution?.rows?.map((r) => ({ model: r.model, messages: r.messages })) || null,
          strongShare: strongShare(execution, MODELS.strong),
          tokens: sessionTokens(execution),
          tokensByModel: execution?.rows?.map((r) => ({ model: r.model, input: r.input, output: r.output, reasoning: r.reasoning, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite })) || null,
          cascade: trial.def.plugin ? readCascadeLevel(trial.home) : null,
          void: reason || null,
        }
        if (!reason) record.pass = grade(trial.proj, task).pass
        results.push(record)
        writeFileSync(resultsPath, JSON.stringify(results, null, 2))
        console.log(`${trial.name.padEnd(40)} ${reason ? "VOID " + reason : record.pass ? "pass" : "fail"}  ${Math.round(record.wallMs / 1000)}s` +
          (record.strongShare !== null ? `  strong=${record.strongShare.toFixed(2)}` : "") +
          `  tokens=${record.tokens ?? "?"}  total=${budgetLeft(results, BUDGET_TOKENS).spent}`)
      }
    }
  }
  report(results)
}

main()
