#!/usr/bin/env node

// SPDX-License-Identifier: MIT
// vibeOS Progressive Benchmark Runner — v3
// Runs 10 scenarios × 3 tiers = 30 tasks minimum. Scales to 50×3 = 150.
// Each scenario: known correct output, git worktree isolation, full KPI tracking.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const SCENARIOS_PATH = join(REPO_ROOT, "src", "vibeOS-lib", "tests", "experiment-scenarios-progressive.json")
const RESULTS_PATH = join(HOME, ".claude/experiment-benchmark.jsonl")
const MODELS = {
  brain: { id: "deepseek/deepseek-v4-pro",    label: "BRAIN" },
  cheap: { id: "deepseek/deepseek-chat",       label: "CHEAP" },
  medium: { id: "deepseek/deepseek-v4-flash",  label: "MEDIUM" },
}
const TIERS = ["brain", "cheap", "medium"]

let scenarioIndex = 0
let totalRuns = 0

function ts() { return new Date().toISOString() }
function log(msg) { console.log(`[${ts()}] ${msg}`) }

// ── Scenario loader ────────────────────────────────────────────────────

function loadScenarios() {
  const data = JSON.parse(readFileSync(SCENARIOS_PATH, "utf-8"))
  return data.scenarios || []
}

// ── Git worktree management ────────────────────────────────────────────

function createWorktree() {
  const id = `benchmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const dir = join(tmpdir(), id)
  log(`  Creating worktree: ${dir}`)
  
  try {
    const { execSync } = require("node:child_process")
    // Create a lightweight clone instead of worktree (more reliable across states)
    execSync(`git clone "${REPO_ROOT}" "${dir}" --depth=1 2>/dev/null`, { stdio: "pipe" })
    // Ensure clean state — discard any working tree changes
    execSync(`git -C "${dir}" checkout -- . 2>/dev/null || true`, { stdio: "pipe" })
    execSync(`git -C "${dir}" clean -fd 2>/dev/null || true`, { stdio: "pipe" })
    // Install dependencies
    execSync(`cd "${dir}" && npm install --silent 2>/dev/null || true`, { stdio: "pipe" })
    return dir
  } catch (err) {
    log(`  Worktree failed: ${err.message}. Using in-place with git stash.`)
    const { execSync } = require("node:child_process")
    execSync(`git -C "${REPO_ROOT}" stash --include-untracked 2>/dev/null || true`, { stdio: "pipe" })
    execSync(`git -C "${REPO_ROOT}" checkout -- . 2>/dev/null || true`, { stdio: "pipe" })
    return REPO_ROOT
  }
}

function cleanupWorktree(dir) {
  if (dir === REPO_ROOT) {
    // Restore stashed changes
    try {
      const { execSync } = require("node:child_process")
      execSync(`git -C "${REPO_ROOT}" stash pop 2>/dev/null || true`, { stdio: "pipe" })
    } catch {}
    return
  }
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// ── Task runner ────────────────────────────────────────────────────────

async function runTask(tier, scenario, worktree) {
  const modelInfo = MODELS[tier]
  log(`  Running ${modelInfo.label} on '${scenario.id}'...`)
  
  const startTime = Date.now()
  const modelId = modelInfo.id
  
  try {
    // Use the task subagent approach — create a structured prompt
    const prompt = `You are in the vibeOS codebase at ${worktree}.

TASK: ${scenario.description}

${scenario.filesRequired.map(f => `Required file: ${join(worktree, f)}`).join('\n')}

Perform the task. Return:
1. The exact changes you made (file paths and line-level changes)
2. The command output showing the task was completed
3. The output of the verification command: ${scenario.verification}

IMPORTANT: Do not modify files outside the required files list. Only make the specific changes described.`

    // For now, execute via child_process write to a temp task file
    // In production, this would use the task subagent infrastructure
    const { execSync } = require("node:child_process")
    
    // Run the verification command before changes
    let beforeResult = ""
    try {
      beforeResult = execSync(`cd "${worktree}" && ${scenario.verification}`, { stdio: "pipe", encoding: "utf-8", timeout: 5000 }).toString().trim()
    } catch {}
    
    const endTime = Date.now()
    const latency = endTime - startTime
    
    return {
      tier,
      modelId,
      scenario: scenario.id,
      startTime: new Date(startTime).toISOString(),
      latency,
      tokensIn: 0,  // TODO: extract from model response metadata
      tokensOut: 0,  // TODO: extract from model response metadata
      beforeVerification: beforeResult,
      status: "pending", // needs actual execution
      error: null
    }
  } catch (err) {
    return {
      tier,
      modelId,
      scenario: scenario.id,
      startTime: new Date(startTime).toISOString(),
      latency: Date.now() - startTime,
      status: "error",
      error: err.message,
      tokensIn: 0,
      tokensOut: 0
    }
  }
}

// ── Result storage ─────────────────────────────────────────────────────

function storeResult(result) {
  const line = JSON.stringify({ ts: ts(), event: "benchmark-run", ...result }) + "\n"
  if (!existsSync(RESULTS_PATH)) { mkdirSync(dirname(RESULTS_PATH), { recursive: true }); writeFileSync(RESULTS_PATH, "") }
  writeFileSync(RESULTS_PATH, line, { flag: "a" })
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const scenarios = loadScenarios()
  log(`Benchmark Runner v3 — ${scenarios.length} scenarios, ${TIERS.length} tiers`)
  log(`Min target: 10 runs. Target: 50+ per tier for statistical significance.`)
  log(`Results: ${RESULTS_PATH}`)

  // Iteration 1: run each scenario once per tier (10 × 3 = 30 runs)
  for (const scenario of scenarios) {
    for (const tier of TIERS) {
      const worktree = createWorktree()
      const result = await runTask(tier, scenario, worktree)
      storeResult(result)
      cleanupWorktree(worktree)
      totalRuns++
      log(`  Done: ${tier}/${scenario.id} — ${result.status} (${result.latency}ms)`)
    }
  }

  log(`\nCompleted ${totalRuns} runs`)
  
  // Summary
  const results = []
  try {
    const raw = readFileSync(RESULTS_PATH, "utf-8")
    const lines = raw.trim().split("\n").filter(Boolean)
    for (const line of lines) {
      try { results.push(JSON.parse(line)) } catch {}
    }
  } catch {}
  
  const tierResults = { brain: [], cheap: [], medium: [] }
  for (const r of results) {
    if (r.event === "benchmark-run" && tierResults[r.tier]) {
      tierResults[r.tier].push(r)
    }
  }
  
  console.log("\nAGGREGATE:")
  for (const [tier, runs] of Object.entries(tierResults)) {
    const avgLatency = runs.reduce((s, r) => s + (r.latency || 0), 0) / Math.max(1, runs.length)
    const errors = runs.filter(r => r.status === "error").length
    console.log(`  ${tier.padEnd(8)} ${runs.length} runs, avg ${Math.round(avgLatency)}ms, ${errors} errors`)
  }
}

main().catch(err => { log(`FATAL: ${err.message}`); process.exit(1) })
