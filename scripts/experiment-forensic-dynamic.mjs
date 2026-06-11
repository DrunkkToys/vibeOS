#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Experiment: STATIC vs DYNAMIC (FORENSIC) system prompt injection
// Hypothesis: Dynamic injection with FORENSIC directive for HARD scenarios
// produces measurably better code quality than static injection.
//
// Usage: DEEPSEEK_API_KEY=xxx node scripts/experiment-forensic-dynamic.mjs

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const SCENARIOS_PATH = resolve(PROJECT, "src", "vibeOS-lib", "tests", "experiment-scenarios.json")
const RESULTS_LOG = join(HOME, ".claude", "experiment-forensic-results.jsonl")
const REPORT_DIR = join(HOME, ".claude", "reports")
const REPORT_PATH = join(REPORT_DIR, "experiment-forensic-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json")

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) {
  console.error("FATAL: DEEPSEEK_API_KEY not set")
  process.exit(1)
}

// === FORENSIC PROMPT DIRECTIVE ===
const FORENSIC_DIRECTIVE = [
  "[forensic mode] This turn uses FORENSIC analysis depth:",
  "- Evidence-based: trace each design decision and implementation choice to its justification",
  "- Multi-hypothesis: consider 2+ competing approaches before converging on the final solution",
  "- Explicit uncertainty: flag assumptions, trade-offs, and unknown edge cases",
  "- Structured output: organize code with clear sections, reasoning traces, and explicit documentation",
  "- Thorough verification: validate all assumptions, handle all edge cases, cover all error paths",
].join("\n")

// === STATIC system prompt (baseline — current injection) ===
function buildStaticSystemPrompt() {
  return [
    "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
    "[batch execution] When running multiple independent operations, invoke them ALL in parallel.",
    "[project guard] AGENTS.md and README.md are protected. Do NOT modify without permission.",
    "[orchestrator] Delegate implementation work to Task subagents. Your role: verify and synthesize.",
    "[code quality] Write production-grade code with proper error handling, types, and tests.",
  ].join("\n")
}

// === DYNAMIC system prompt (same base + FORENSIC for HARD scenarios) ===
function buildDynamicSystemPrompt(scenario) {
  const base = buildStaticSystemPrompt()
  const hardDomains = ["arch", "systems", "algorithm"]
  const isHard = scenario.complexity === "hard" && hardDomains.includes(scenario.domain)
  if (!isHard) return base
  return base + "\n\n" + FORENSIC_DIRECTIVE
}

// === API call ===
async function callDeepSeek(systemPrompt, userPrompt, model = "deepseek-chat") {
  const start = Date.now()
  const url = "https://api.deepseek.com/v1/chat/completions"
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 8192,
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY,
    },
    body: JSON.stringify(body),
  })
  const elapsed = Date.now() - start
  if (!resp.ok) {
    const e = await resp.text()
    return { ok: false, elapsed, error: resp.status + ": " + e.slice(0, 200) }
  }
  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content || ""
  const finish = data.choices?.[0]?.finish_reason || "unknown"
  const usage = data.usage || {}
  const tokensIn = usage.prompt_tokens || 0
  const tokensOut = usage.completion_tokens || 0
  return { ok: true, elapsed, content, tokensIn, tokensOut, finish, responseLen: content.length }
}

// === Scoring (from nightly-experiment.mjs) ===
function scoreOutput(text, scenario) {
  if (!text) return { correctness: 0, completeness: 0, safety: 0, wordCount: 0 }

  const scores = { correctness: 0.3, completeness: 0, safety: 1, wordCount: text.split(/\s+/).length }
  const criteria = scenario.passCriteria || {}

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
  if (criteria.hasJSDoc && (text.includes("@param") || text.includes("@returns"))) {
    scores.completeness += 0.1
  }
  if (criteria.hasErrorHandling && (text.includes("throw") || text.includes("Error"))) {
    scores.correctness += 0.1
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
  if (criteria.rateLimitedCorrectly && (text.includes("Map") || text.includes("Retry-After"))) {
    scores.correctness += 0.1
  }
  if (criteria.cancellationWorks && text.includes("AbortSignal")) {
    scores.completeness += 0.1
  }
  if (criteria.concurrencyCorrect && text.includes("Promise")) {
    scores.completeness += 0.1
  }

  if (text.includes("eval(")) scores.safety -= 0.3
  if (text.includes("process.exit") && !text.includes("test")) scores.safety -= 0.1
  scores.safety = Math.max(0, Math.min(1, scores.safety))
  scores.completeness = Math.min(1, scores.completeness)
  scores.correctness = Math.min(1, scores.correctness)

  return scores
}

// === Log result ===
function logResult(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n"
  appendFileSync(RESULTS_LOG, line)
}

// === Main ===
async function main() {
  const scenarios = JSON.parse(readFileSync(SCENARIOS_PATH, "utf-8")).scenarios
  const model = "deepseek-chat"
  console.log(`=== STATIC vs DYNAMIC (FORENSIC) INJECTION EXPERIMENT ===`)
  console.log(`Model: ${model}`)
  console.log(`Scenarios: ${scenarios.length}`)
  console.log(`Total calls: ${scenarios.length * 2} (STATIC + DYNAMIC per scenario)\n`)

  const results = []

  for (const sc of scenarios) {
    const userPrompt = `${sc.prompt}\n\nWrite the output code. Include tests if possible.`

    for (const variant of ["static", "dynamic"]) {
      const systemPrompt = variant === "static"
        ? buildStaticSystemPrompt()
        : buildDynamicSystemPrompt(sc)

      process.stdout.write(`  ${sc.id} [${variant}]... `)
      const r = await callDeepSeek(systemPrompt, userPrompt, model)

      if (!r.ok) {
        console.log(`ERR ${r.elapsed}ms ${r.error}`)
        logResult({ event: "forensic-experiment", variant, scenario: sc.id, complexity: sc.complexity, domain: sc.domain, ok: false, error: r.error, latency_ms: r.elapsed })
        results.push({
          scenario: sc.id, complexity: sc.complexity, domain: sc.domain, variant,
          ok: false, error: r.error, latency_ms: r.elapsed,
        })
        continue
      }

      const scores = scoreOutput(r.content, sc)
      const combined = scores.correctness + scores.completeness + scores.safety
      console.log(`${r.elapsed}ms tok=${r.tokensIn}/${r.tokensOut} score=${combined.toFixed(2)}`)

      logResult({
        event: "forensic-experiment", variant, scenario: sc.id,
        complexity: sc.complexity, domain: sc.domain,
        ok: true, latency_ms: r.elapsed,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut,
        correctness: scores.correctness,
        completeness: scores.completeness,
        safety: scores.safety,
        combined_score: combined,
        response_len: r.responseLen,
        finish: r.finish,
      })
      results.push({
        scenario: sc.id, complexity: sc.complexity, domain: sc.domain, variant,
        ok: true, latency_ms: r.elapsed,
        tokens_in: r.tokensIn, tokens_out: r.tokensOut,
        correctness: scores.correctness,
        completeness: scores.completeness,
        safety: scores.safety,
        combined_score: combined,
      })
    }
  }

  // === ANALYSIS ===
  console.log("\n\n========== EXPERIMENT RESULTS ==========")
  const ok = results.filter(r => r.ok)
  const staticRuns = ok.filter(r => r.variant === "static")
  const dynamicRuns = ok.filter(r => r.variant === "dynamic")

  const avg = (arr, key) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

  const staticAvg = {
    correctness: avg(staticRuns, "correctness"),
    completeness: avg(staticRuns, "completeness"),
    safety: avg(staticRuns, "safety"),
    combined: avg(staticRuns, "combined_score"),
    latency: avg(staticRuns, "latency_ms"),
  }
  const dynamicAvg = {
    correctness: avg(dynamicRuns, "correctness"),
    completeness: avg(dynamicRuns, "completeness"),
    safety: avg(dynamicRuns, "safety"),
    combined: avg(dynamicRuns, "combined_score"),
    latency: avg(dynamicRuns, "latency_ms"),
  }

  console.log(`\n=== OVERALL ===`)
  console.log(`STATIC  (${staticRuns.length} runs):  corr=${staticAvg.correctness.toFixed(3)} comp=${staticAvg.completeness.toFixed(3)} safe=${staticAvg.safety.toFixed(3)} combined=${staticAvg.combined.toFixed(3)} lat=${Math.round(staticAvg.latency)}ms`)
  console.log(`DYNAMIC (${dynamicRuns.length} runs): corr=${dynamicAvg.correctness.toFixed(3)} comp=${dynamicAvg.completeness.toFixed(3)} safe=${dynamicAvg.safety.toFixed(3)} combined=${dynamicAvg.combined.toFixed(3)} lat=${Math.round(dynamicAvg.latency)}ms`)
  console.log(`DELTA:   ${(dynamicAvg.combined - staticAvg.combined).toFixed(3)} (positive = DYNAMIC better)`)

  // Per-complexity breakdown
  console.log(`\n=== BY COMPLEXITY ===`)
  for (const complexity of ["medium", "hard"]) {
    const sByComp = staticRuns.filter(r => r.complexity === complexity)
    const dByComp = dynamicRuns.filter(r => r.complexity === complexity)
    if (sByComp.length === 0 && dByComp.length === 0) continue
    const sc = avg(sByComp, "combined_score")
    const dc = avg(dByComp, "combined_score")
    const label = sByComp.length + "/" + dByComp.length + " runs"
    console.log(`${complexity.padEnd(10)} STATIC=${sc.toFixed(3)} DYNAMIC=${dc.toFixed(3)} DELTA=${(dc - sc).toFixed(3)} ${label}`)
  }

  // Per-domain breakdown
  console.log(`\n=== BY DOMAIN ===`)
  const domains = [...new Set(ok.map(r => r.domain))]
  for (const domain of domains.sort()) {
    const sByDom = staticRuns.filter(r => r.domain === domain)
    const dByDom = dynamicRuns.filter(r => r.domain === domain)
    if (sByDom.length === 0 && dByDom.length === 0) continue
    const sc = avg(sByDom, "combined_score")
    const dc = avg(dByDom, "combined_score")
    const label = sByDom.length + "/" + dByDom.length + " runs"
    console.log(`${domain.padEnd(12)} STATIC=${sc.toFixed(3)} DYNAMIC=${dc.toFixed(3)} DELTA=${(dc - sc).toFixed(3)} ${label}`)
  }

  // Hypothesis verdict
  const delta = dynamicAvg.combined - staticAvg.combined
  let verdict
  if (delta > 0.15) verdict = "DYNAMIC FORENSIC injection produces measurably better outputs — hypothesis CONFIRMED"
  else if (delta > 0.05) verdict = "DYNAMIC FORENSIC injection shows marginal improvement — hypothesis TENTATIVE"
  else if (delta > -0.05) verdict = "No significant difference — hypothesis INCONCLUSIVE"
  else verdict = "STATIC injection performed better — hypothesis REJECTED"

  console.log(`\n=== VERDICT ===`)
  console.log(verdict)

  // === GENERATE REPORT ===
  mkdirSync(REPORT_DIR, { recursive: true })
  const report = {
    meta: {
      generated_at: new Date().toISOString(),
      experiment: "STATIC vs DYNAMIC (FORENSIC) system prompt injection",
      hypothesis: "Dynamic injection with FORENSIC directive for HARD scenarios (arch, systems, algorithm) produces measurably better code quality than static injection.",
      model,
      total_calls: results.length,
      successful: ok.length,
      errors: results.length - ok.length,
      cost_notes: "Cost depends on DeepSeek API usage. See cost_est below.",
    },
    overall: {
      static: staticAvg,
      dynamic: dynamicAvg,
      delta: delta.toFixed(4),
      verdict,
    },
    by_complexity: {},
    by_domain: {},
    raw: results,
  }

  for (const complexity of ["medium", "hard"]) {
    const s = staticRuns.filter(r => r.complexity === complexity)
    const d = dynamicRuns.filter(r => r.complexity === complexity)
    if (s.length || d.length) {
      report.by_complexity[complexity] = {
        static: { runs: s.length, combined: avg(s, "combined_score") },
        dynamic: { runs: d.length, combined: avg(d, "combined_score") },
      }
    }
  }

  for (const domain of domains.sort()) {
    const s = staticRuns.filter(r => r.domain === domain)
    const d = dynamicRuns.filter(r => r.domain === domain)
    if (s.length || d.length) {
      report.by_domain[domain] = {
        static: { runs: s.length, combined: avg(s, "combined_score") },
        dynamic: { runs: d.length, combined: avg(d, "combined_score") },
      }
    }
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nReport: ${REPORT_PATH}`)
  console.log(`Log: ${RESULTS_LOG}`)
  console.log(`\nTip: To re-analyze without re-running: node -e 'JSON.parse(require("fs").readFileSync("${REPORT_PATH}","utf-8"))'`)
}

main().catch(err => { console.error(err); process.exit(1) })
