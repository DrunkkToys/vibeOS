#!/usr/bin/env node

// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

// Nightly Experiment Runner — A/B testing quality vs budget via task subagents
// Hypothesis: Quality mode (brain tier, full thinking) produces better code than budget (cheap tier)
// 
// This runs as part of an opencode session (not standalone). It uses the task() subagent
// infrastructure to execute the same prompts in both quality and budget tiers,
// then compares the outputs automatically.
//
// Cron entry: 0 0 * * * opencode run "run experiment" --pure
// (Or triggered manually via: trinity experiment)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const SCENARIOS_PATH = resolve(__dirname, "..", "src", "vibeOS-lib", "tests", "experiment-scenarios.json")
const VIBEOS_HOME = process.env.VIBEOS_HOME?.trim() || join(HOME, ".vibeos")
const RESULTS_PATH = join(VIBEOS_HOME, "experiment-results.jsonl")
const RESULTS_SUMMARY = join(VIBEOS_HOME, "experiment-results-summary.json")

function ts() { return new Date().toISOString() }
function log(msg) { console.log(`[${ts()}] ${msg}`) }

function writeResult(event) {
  const line = JSON.stringify({ ts: ts(), ...event }) + "\n"
  if (!existsSync(RESULTS_PATH)) writeFileSync(RESULTS_PATH, "")
  writeFileSync(RESULTS_PATH, line, { flag: "a" })
}

// ── Load scenarios ─────────────────────────────────────────────────────

function loadScenarios() {
  try {
    const data = JSON.parse(readFileSync(SCENARIOS_PATH, "utf-8"))
    return data
  } catch (err) {
    log(`FATAL: Cannot read scenarios: ${err.message}`)
    process.exit(1)
  }
}

// ── Score output ───────────────────────────────────────────────────────

function scoreOutput(text, scenario, mode) {
  if (!text) return { correctness: 0, completeness: 0, safety: 0, wordCount: 0 }

  const scores = { correctness: 0.3, completeness: 0, safety: 1, wordCount: text.split(/\s+/).length }
  const criteria = scenario.passCriteria || {}

  // File existence (check for expected patterns)
  if (text.includes("function") || text.includes("class") || text.includes("export") || text.includes("import")) {
    scores.completeness += 0.2
  }
  if (text.includes("error") || text.includes("throw") || text.includes("catch") || text.includes("try")) {
    scores.correctness += 0.15
  }
  if (text.includes("return") || text.includes("=>")) {
    scores.completeness += 0.2
  }
  if (criteria.hasTypeAnnotation && (text.includes(": string") || text.includes(": number") || text.includes(": boolean") || text.includes("<T>"))) {
    scores.completeness += 0.15
  }
  if (criteria.hasJSDoc && text.includes("@param") || text.includes("@returns")) {
    scores.completeness += 0.1
  }
  if (criteria.hasErrorHandling && (text.includes("throw") || text.includes("Error"))) {
    scores.correctness += 0.1
  }
  if (criteria.usesBigInt && text.includes("BigInt")) {
    scores.completeness += 0.1
  }
  if (criteria.genericsUsed && text.includes("<T>")) {
    scores.completeness += 0.1
  }
  if (criteria.memoized && (text.includes("cache") || text.includes("Map") || text.includes("memo"))) {
    scores.completeness += 0.1
  }
  if (criteria.cleanupImplemented && (text.includes("clean") || text.includes("setInterval") || text.includes("clear"))) {
    scores.safety += 0.05
  }

  // Safety checks
  if (text.includes("eval(")) scores.safety -= 0.3
  if (text.includes("process.exit") && !text.includes("test")) scores.safety -= 0.1
  scores.safety = Math.max(0, Math.min(1, scores.safety))
  scores.completeness = Math.min(1, scores.completeness)
  scores.correctness = Math.min(1, scores.correctness)

  return scores
}

// ── Single scenario runner ─────────────────────────────────────────────

async function runScenario(scenario) {
  const runId = `${ts().replace(/[:-]/g, "")}-${scenario.id}`
  log(`\n[SCENARIO] ${scenario.id} (${scenario.domain}/${scenario.complexity})`)

  const results = { scenario: scenario.id, runId, domain: scenario.domain, complexity: scenario.complexity, runs: {} }

  const prompt = `${scenario.prompt}\n\nWrite the output code. Include tests if possible. Keep it concise.`

  for (const mode of ["quality", "budget"]) {
    log(`  [MODE] ${mode}`)

    // This is where the actual subagent call would go.
    // In production, these are replaced with real task() calls from the orchestrator.
    // For the experiment runner, we output the prompt + expected model so the
    // orchestrator (running opencode) can execute it via Task subagents.
    //
    // Output format: structured task definitions that the session can consume

    const taskDef = {
      scenario: scenario.id,
      mode,
      runId,
      prompt,
      model: mode === "quality" ? "deepseek/deepseek-v4-pro" : "deepseek/deepseek-chat",
      timestamp: ts()
    }

    console.log(JSON.stringify({
      event: "experiment-task",
      ...taskDef
    }))

    results.runs[mode] = { status: "queued", taskDef }
  }

  return results
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  log("vibeOS Experiment Runner — generating task definitions for orchestrator")

  const data = loadScenarios()
  const pool = data.scenarios || []
  if (pool.length === 0) { log("No scenarios"); process.exit(0) }

  const rotation = data.rotation || { scenariosPerNight: 2 }
  const selected = pool.slice(0, rotation.scenariosPerNight)
  log(`Selected ${selected.length} scenarios: ${selected.map(s => s.id).join(", ")}`)

  const summary = {
    timestamp: ts(),
    hypothesis: data.meta?.experiment_hypothesis,
    scenarios: selected.map(s => s.id),
    tasks: []
  }

  for (const scenario of selected) {
    const result = await runScenario(scenario)
    summary.tasks.push(result)
  }

  writeResult({ event: "experiment-batch", tasks: summary.tasks.length, hypothesis: summary.hypothesis })
  log(`Done. ${summary.tasks.length * 2} tasks queued (2 modes x ${summary.tasks.length} scenarios)`)
  log("Tasks are output as JSON lines above. Use them as task() subagent calls in the orchestrator.")
}

main().catch(err => { log(`FATAL: ${err.message}`); process.exit(1) })

// ── Scoring utility (callable from orchestrator after task completes) ──

export function evaluateExperimentRuns() {
  try {
    const raw = readFileSync(RESULTS_PATH, "utf-8")
    const lines = raw.trim().split("\n").filter(Boolean)
    const tasks = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(t => t && t.event === "experiment-task")

    if (tasks.length < 2) return { conclusion: "Not enough data — need at least 1 quality + 1 budget run", counts: { quality: 0, budget: 0 } }

    const qualityTasks = tasks.filter(t => t.mode === "quality")
    const budgetTasks = tasks.filter(t => t.mode === "budget")
    const results = { quality: [], budget: [] }

    for (const task of qualityTasks) {
      const scores = scoreOutput(task.output || task.result || "", { passCriteria: {} }, "quality")
      results.quality.push(scores)
    }
    for (const task of budgetTasks) {
      const scores = scoreOutput(task.output || task.result || "", { passCriteria: {} }, "budget")
      results.budget.push(scores)
    }

    const avg = (arr, key) => arr.length ? arr.reduce((s, v) => s + (v[key] || 0), 0) / arr.length : 0
    const qAvg = { correct: avg(results.quality, "correctness"), complete: avg(results.quality, "completeness"), safe: avg(results.quality, "safety") }
    const bAvg = { correct: avg(results.budget, "correctness"), complete: avg(results.budget, "completeness"), safe: avg(results.budget, "safety") }
    const delta = (qAvg.correct + qAvg.complete + qAvg.safe) - (bAvg.correct + bAvg.complete + bAvg.safe)

    const summary = {
      timestamp: ts(),
      sampleCount: { quality: results.quality.length, budget: results.budget.length },
      qualityAvg: qAvg,
      budgetAvg: bAvg,
      delta,
      conclusion: delta > 0.1 ? "Quality mode produced measurably better outputs" : delta < -0.1 ? "Budget mode performed better — hypothesis rejected" : "No significant difference — inconclusive"
    }
    writeFileSync(RESULTS_SUMMARY, JSON.stringify(summary, null, 2))
    return summary
  } catch (err) {
    return { conclusion: `Error: ${err.message}` }
  }
}
