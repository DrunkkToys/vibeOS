#!/usr/bin/env node
// v4: Test known prompt engineering keyword patterns vs static baseline
// "do NOT lie", "think step by step", "you are an expert", "be honest", "take deep breath", "be concise"
// Parallel execution, same scenarios as v3

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const RESULTS_LOG = join(HOME, ".claude", "experiment-v4-results.jsonl")
const REPORT_DIR = join(HOME, ".claude", "reports")
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z"
const REPORT_PATH = join(REPORT_DIR, `experiment-v4-keywords-${ts}.json`)

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("FATAL: DEEPSEEK_API_KEY not set"); process.exit(1) }

const CONCURRENCY = 5

const SCENARIOS = [
  { id: "api-authenticate",       domain: "api",      complexity: "medium", prompt: "Create an Express.js auth middleware in TypeScript that validates JWT tokens from the Authorization header, attaches user ID to req.user, returns 401 if missing/expired/invalid. Include proper types and error handling." },
  { id: "refactor-extract-fn",    domain: "refactor", complexity: "medium", prompt: "Refactor this TypeScript function by extracting validation and formatting into separate pure functions while preserving the public API." },
  { id: "api-rate-limiter",        domain: "api",      complexity: "hard",   prompt: "Implement a sliding window rate limiter for Express.js in TypeScript: 1) limit N requests per window per IP, 2) in-memory Map store, 3) return 429 with Retry-After, 4) auto-cleanup expired entries, 5) export as createRateLimiter(windowMs, maxRequests). Include comprehensive tests." },
  { id: "arch-rest-api-tasks",     domain: "arch",     complexity: "hard",   prompt: "Design a multi-file REST API for a task manager in TypeScript. Files: types.ts, store.ts, middleware/, routes.ts, app.ts. Return ALL 5 complete files." },
  { id: "systems-task-runner",     domain: "systems",  complexity: "hard",   prompt: "Implement a concurrent task runner in TypeScript: accept async tasks + concurrency limit N, run N simultaneously via semaphore, collect results in order, cancel remaining on reject, support AbortSignal, TaskRunner class with run/cancel/status(). Use generics TaskRunner<T>." },
  { id: "refactor-monolith-split", domain: "refactor", complexity: "hard",   prompt: "Split this monolith into models/user.ts, utils/validation.ts, repositories/userRepository.ts, services/userService.ts." },
  { id: "arch-state-machine",      domain: "arch",     complexity: "hard",   prompt: "Implement a type-safe finite state machine in TypeScript. Generic over S and E. Methods: transition, can, onEnter/onExit/onTransition, getHistory, reset, getState." },
  { id: "algorithm-dijkstra",      domain: "algorithm",complexity: "hard",   prompt: "Implement Dijkstra's shortest path in TypeScript with BinaryHeap. Handle empty graph, start=end, disconnected, negative weights, cycles." },
  { id: "short-qa-tcp-udp",       domain: "general",  complexity: "easy",   prompt: "What is the difference between TCP and UDP? Answer in 2-3 sentences." },
  { id: "medium-explain-raft",    domain: "arch",     complexity: "medium", prompt: "Explain how a distributed consensus algorithm like Raft works. ~500 words." },
  { id: "short-math-primes",      domain: "algorithm",complexity: "easy",   prompt: "Calculate the sum of all prime numbers between 1 and 100. Show your work." },
  { id: "medium-architecture-docs",domain: "arch",    complexity: "medium", prompt: "Design architecture for a real-time collaborative document editor. ~500 words." },
  { id: "long-codegen-lru",       domain: "systems",  complexity: "hard",   prompt: "Implement a complete LRU cache in TypeScript with generics, O(1) get/put, TTL, event emitter for evictions. ~200 lines." },
  { id: "long-api-design-saas",   domain: "api",      complexity: "hard",   prompt: "Design a REST API for a multi-tenant SaaS platform. Include JWT auth, RBAC, CRUD, rate limiting, pagination, soft delete, audit logging." },
  { id: "race-condition-debug",       domain: "debug",    complexity: "hard", prompt: "Analyze this TypeScript code for race conditions. Identify ALL race conditions and provide corrected version." },
  { id: "security-vuln-audit",       domain: "security",  complexity: "hard", prompt: "Audit this Express app for ALL security vulnerabilities. For each: attack vector, impact, fixed code." },
  { id: "production-incident-rca",   domain: "debug",    complexity: "hard", prompt: "A production incident: users get intermittent 500 errors during peak hours. 'ETIMEDOUT' from payment gateway and 'ECONNRESET' from DB. Analyze root cause." },
  { id: "architectural-tradeoff",    domain: "arch",     complexity: "hard", prompt: "Design event ingestion pipeline for 50k events/sec. Compare 3 approaches: Kafka->Flink->S3, RabbitMQ->Node->PostgreSQL, Kinesis->Lambda->DynamoDB." },
  { id: "memory-leak-investigation", domain: "debug",    complexity: "hard", prompt: "Node.js process grows to 2GB RSS after 24h. 800k RequestHandler instances. Find ALL memory leaks, trace GC root paths, provide fixes." },
  { id: "code-review-security",      domain: "audit",    complexity: "hard", prompt: "Code review a payment processing module. Find ALL bugs, security issues, anti-patterns. Classify as CRITICAL/HIGH/MEDIUM/LOW." },
  { id: "performance-bottleneck",    domain: "systems",  complexity: "hard", prompt: "Diagnose bottleneck in a data pipeline processing 100k records in 45s. Each record: API enrich -> validate -> transform -> DB insert. Find ALL bottlenecks, provide optimized code." },
  { id: "compiler-error-chain",      domain: "debug",    complexity: "hard", prompt: "Trace this TypeScript error: 'Type string | undefined is not assignable to type string'. Trace through ALL intermediate types and generics." },
  { id: "refactor-preserve-behavior",domain: "arch",     complexity: "hard", prompt: "Refactor callback-based code to async/await preserving exact behavior including error propagation and edge cases." },
  { id: "api-conflicting-requirements",domain:"arch",    complexity:"hard", prompt:"Design an API reconciling: paginated + multi-filter + sorted results on 10M rows, <200ms P99, computed fields, activity summaries, REST+GraphQL." },
  { id: "concurrency-deadlock",      domain: "debug",    complexity: "hard", prompt: "Analyze TypeScript code for ALL deadlock scenarios. For each: exact thread interleaving, why deadlock, the fix." },
  { id: "data-integrity-violation", domain: "security", complexity: "hard", prompt: "Analyze order processing system for data integrity violations. For each: exact race condition, data corruption, fix." },
  { id: "dependency-conflict",       domain: "systems",  complexity: "hard", prompt: "Monorepo with 3 packages with conflicting react/react-router versions. Analyze conflict matrix, hoisting strategies, recommend best resolution." },
  { id: "auth-flow-audit",            domain: "security", complexity: "hard", prompt: "Audit this authentication flow for ALL vulnerabilities and logic flaws." },
  { id: "state-corruption-analysis", domain: "debug",    complexity: "hard", prompt: "React app has state corruption where UI shows stale data after navigation. Trace data flow, find ALL root causes." },
  { id: "distributed-system-failure", domain: "systems",  complexity: "hard", prompt: "Service chain fails intermittently with context deadline exceeded, broken pipe, connection refused during peak hours. Diagnose." },
  { id: "deployment-rollback-analysis",domain:"audit",   complexity:"hard", prompt:"Deployment caused partial outage. Rollback made it worse. Analyze timeline, root cause, rollback process failure, monitoring gaps." },
].map((s, i) => ({ ...s, order: i }))

// === Prompt pattern directives ===
const KEYWORD_MODES = {
  static: null,  // baseline

  dont_lie: [
    "[instruction] Do NOT lie or make up information. If you are unsure about something, state your uncertainty explicitly. Be honest about the limitations of your knowledge. Never fabricate facts, citations, or code that doesn't exist. It is better to say 'I don't know' than to guess.",
  ].join(" "),

  expert: [
    "[instruction] You are a world-class expert with 20+ years of experience in software engineering. Provide expert-level analysis that demonstrates deep understanding. Use your expertise to anticipate edge cases and subtle issues a junior would miss.",
  ].join(" "),

  step_by_step: [
    "[instruction] Think step by step. Break down the problem into sequential reasoning steps. Show your work and reasoning at each step before arriving at the final answer. Use clear numbered steps or logical phases.",
  ].join(" "),

  deep_breath: [
    "[instruction] Take a deep breath and work on this problem step-by-step. Approach this methodically and carefully. Do not rush to a conclusion — verify each step before moving to the next.",
  ].join(" "),

  concise: [
    "[instruction] Be concise and precise. Avoid unnecessary verbosity, introductions, or conclusions. Deliver the essential content directly. Prefer code/output over explanation unless explanation adds unique value.",
  ].join(" "),

  truthful: [
    "[instruction] Be truthful and accurate in all responses. If you don't have enough information to answer confidently, say so. Flag any assumptions you are making. Prioritize correctness over completeness.",
  ].join(" "),
}

const STATIC_BASE = [
  "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
  "[batch execution] When running multiple independent operations, invoke them ALL in parallel.",
  "[project guard] AGENTS.md and README.md are protected. Do NOT modify without permission.",
  "[orchestrator] Delegate implementation work to Task subagents. Your role: verify and synthesize.",
  "[code quality] Write production-grade code with proper error handling, types, and tests.",
].join("\n")

function buildSystemPrompt(mode) {
  const directive = KEYWORD_MODES[mode]
  if (directive) return STATIC_BASE + "\n\n" + directive
  return STATIC_BASE
}

async function callDeepSeek(systemPrompt, userPrompt) {
  const start = Date.now()
  const body = { model: "deepseek-chat", messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], max_tokens: 8192 }
  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
      body: JSON.stringify(body),
    })
    const elapsed = Date.now() - start
    if (!resp.ok) return { ok: false, elapsed, error: resp.status + " " + (await resp.text()).slice(0, 100) }
    const data = await resp.json()
    const content = data.choices?.[0]?.message?.content || ""
    return { ok: true, elapsed, content, tokensIn: data.usage?.prompt_tokens || 0, tokensOut: data.usage?.completion_tokens || 0 }
  } catch (e) { return { ok: false, elapsed: Date.now() - start, error: e.message } }
}

function scoreOutput(text) {
  if (!text) return { correctness: 0, completeness: 0, safety: 0, combined: 0 }
  const l = text.toLowerCase()
  let c = 0.3, comp = 0, s = 1
  if (/error|throw|catch|try/i.test(text)) c += 0.15
  if (/return|=>/.test(text)) c += 0.1
  if (/function|class|interface/.test(text)) c += 0.1
  if (/test|describe|it\s*\(/.test(l)) c += 0.1
  if (/\bPromise\b/.test(text)) c += 0.05
  if (/async/.test(text) && /await/.test(l)) c += 0.05
  if (/function|class|const|let|var/.test(text)) comp += 0.15
  if (/export\s+(default\s+)?(function|class|const)/.test(text)) comp += 0.15
  if (/: (string|number|boolean|void|any|never|Promise|Record|Partial|Pick)\b/.test(text)) comp += 0.1
  if (/import/.test(text)) comp += 0.1
  if (/@param|@returns|JSDoc| \* /.test(text)) comp += 0.1
  if (/test|describe|it\s*\(/.test(l)) comp += 0.15
  if (/eval\s*\(/.test(text)) s -= 0.3
  if (/process\.exit/.test(text) && !/test/i.test(text)) s -= 0.1
  if (/new\s+Function/.test(text)) s -= 0.2
  s = Math.max(0, Math.min(1, s))
  return { correctness: Math.min(1, c), completeness: Math.min(1, comp), safety: s, combined: c + comp + s, wordCount: text.split(/\s+/).length }
}

function forensicMetrics(text) {
  if (!text) return { evidenceDepth:0, hypothesisCoverage:0, uncertaintyDisc:0, structuredOutput:0, thoroughness:0 }
  const l = text.toLowerCase()
  return {
    evidenceDepth: Math.min(1, (l.match(/because|since|therefore|implies?|leads?\s+to|evidence|demonstrat|follows?\s+from|consequently/g) || []).length / 12),
    hypothesisCoverage: Math.min(1, (l.match(/alternativ|hypothes[ei]s|possibility|could\s+be|might\s+be|scenario|consider|approach|maybe|perhaps|potentially/g) || []).length / 10),
    uncertaintyDisc: Math.min(1, (l.match(/unknown|uncertain|ambiguous|assumption|trade-?off|limitation|not\s+clear|unclear|insufficient|incomplete/g) || []).length / 9),
    structuredOutput: Math.min(1, (text.match(/^\d+[\.\)]|^#{1,3}\s|^[-*]\s|^[A-Z][a-z]+:|^###|^##/gm) || []).length / 7),
    thoroughness: Math.min(1, (l.match(/verify|validat|edge\s+case|error\s+(path|handl|case)|failur|except|null\s+check|fallback|recovery/g) || []).length / 10),
  }
}

function honestyCheck(text) {
  // Count honesty signals: uncertainty, limitations, "I don't know", etc.
  if (!text) return { honestyFlags: 0, admitsUncertainty: 0, avoidsFabrication: 0 }
  const l = text.toLowerCase()
  return {
    honestyFlags: (l.match(/i ('m|am) not (sure|certain|confident)|i don't know|i cannot (determine|confirm|verify)|it is (unclear|uncertain)|insufficient (information|data)|my knowledge|as of my (knowledge|training|last)/g) || []).length,
    admitsUncertainty: l.includes("not sure") || l.includes("don't know") || l.includes("cannot determine") ? 1 : 0,
    avoidsFabrication: l.includes("hypothetical") || l.includes("would need to check") || l.includes("based on available") ? 1 : 0,
  }
}

function logResult(e) { appendFileSync(RESULTS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n") }

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true })
  const MODES = Object.keys(KEYWORD_MODES)  // 7 modes
  const total = SCENARIOS.length * MODES.length
  const directions = ["Write a thorough response.", "Be comprehensive.", "Provide complete analysis.", "Include as much detail as possible."]

  console.log(`=== v4: Prompt keyword patterns ===`)
  console.log(`Modes: ${MODES.join(", ")}`)
  console.log(`Scenarios: ${SCENARIOS.length}, Total calls: ${total}`)
  console.log(`Concurrency: ${CONCURRENCY}\n`)

  const tasks = []
  for (const sc of SCENARIOS) {
    for (const mode of MODES) {
      const systemPrompt = buildSystemPrompt(mode)
      const userPrompt = sc.prompt + "\n\n" + directions[sc.order % directions.length]
      tasks.push({ sc, mode, systemPrompt, userPrompt })
      if (tasks.length >= total) break
    }
    if (tasks.length >= total) break
  }

  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]]
  }

  let completed = 0
  const results = []

  async function worker(taskSlice) {
    for (const task of taskSlice) {
      const r = await callDeepSeek(task.systemPrompt, task.userPrompt)
      if (!r.ok) {
        logResult({ event: "v4", variant: task.mode, scenario: task.sc.id, domain: task.sc.domain, complexity: task.sc.complexity, ok: false, error: r.error })
        completed++; continue
      }
      const sc = scoreOutput(r.content)
      const fm = forensicMetrics(r.content)
      const hc = honestyCheck(r.content)
      logResult({ event: "v4", variant: task.mode, scenario: task.sc.id, domain: task.sc.domain, complexity: task.sc.complexity, ok: true, ...sc, ...fm, ...hc, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: r.elapsed })
      results.push({ scenario: task.sc.id, domain: task.sc.domain, complexity: task.sc.complexity, variant: task.mode, ...sc, ...fm, ...hc })
      completed++
      if (completed % 10 === 0 || completed === total) process.stdout.write(`\r  Progress: ${completed}/${total} (${(completed/total*100).toFixed(0)}%)`)
    }
  }

  const chunkSize = Math.ceil(tasks.length / CONCURRENCY)
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) =>
    worker(tasks.slice(i * chunkSize, (i + 1) * chunkSize))
  ))

  process.stdout.write(`\n\n`)

  // ===== ANALYSIS =====
  const ok = results.filter(r => r.combined > 0)
  if (ok.length < 10) { console.log("Not enough data."); return }

  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  const byMode = {}
  for (const r of ok) {
    if (!byMode[r.variant]) byMode[r.variant] = []
    byMode[r.variant].push(r)
  }
  const allModes = Object.keys(byMode).sort()

  console.log(`\n${"MODE".padEnd(14)} ${"n".padEnd(4)} ${"COMBINED".padEnd(10)} ${"CORRECT".padEnd(9)} ${"COMPLETE".padEnd(9)} ${"SAFETY".padEnd(8)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"HONEST".padEnd(7)} ${"LAT".padEnd(6)} ${"TOK".padEnd(5)}`)
  console.log("-".repeat(105))

  const aggs = {}
  for (const mode of allModes) {
    const r = byMode[mode]
    const a = {
      combined: mean(r.map(x => x.combined)),
      correctness: mean(r.map(x => x.correctness)),
      completeness: mean(r.map(x => x.completeness)),
      safety: mean(r.map(x => x.safety)),
      evidence: mean(r.map(x => x.evidenceDepth || 0)),
      hypothesis: mean(r.map(x => x.hypothesisCoverage || 0)),
      uncertainty: mean(r.map(x => x.uncertaintyDisc || 0)),
      thoroughness: mean(r.map(x => x.thoroughness || 0)),
      honestFlags: mean(r.map(x => x.honestyFlags || 0)),
      latency: mean(r.map(x => x.latency || 0)),
      tokens: mean(r.map(x => (x.tokensIn||0) + (x.tokensOut||0))),
    }
    aggs[mode] = a
    console.log(`${mode.padEnd(14)} ${r.length.toString().padEnd(4)} ${a.combined.toFixed(4).padEnd(10)} ${a.correctness.toFixed(4).padEnd(9)} ${a.completeness.toFixed(4).padEnd(9)} ${a.safety.toFixed(4).padEnd(8)} ${a.evidence.toFixed(3).padEnd(6)} ${a.hypothesis.toFixed(3).padEnd(6)} ${a.uncertainty.toFixed(3).padEnd(7)} ${a.thoroughness.toFixed(3).padEnd(6)} ${a.honestFlags.toFixed(2).padEnd(7)} ${a.latency.toFixed(0).padEnd(6)} ${a.tokens.toFixed(0).padEnd(5)}`)
  }

  // Delta from static
  const s = aggs["static"]
  if (s) {
    console.log(`\n=== Delta from STATIC ===`)
    console.log(`${"MODE".padEnd(14)} ${"COMBINED".padEnd(10)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"HONEST".padEnd(7)} ${"LAT".padEnd(6)} ${"TOK".padEnd(6)}`)
    console.log("-".repeat(65))
    for (const mode of allModes.filter(m => m !== "static")) {
      const a = aggs[mode]
      console.log(`${mode.padEnd(14)} ${(a.combined - s.combined >= 0 ? "+" : "") + (a.combined - s.combined).toFixed(4).padEnd(9)} ${(a.evidence - s.evidence >= 0 ? "+" : "") + (a.evidence - s.evidence).toFixed(3).padEnd(5)} ${(a.hypothesis - s.hypothesis >= 0 ? "+" : "") + (a.hypothesis - s.hypothesis).toFixed(3).padEnd(5)} ${(a.uncertainty - s.uncertainty >= 0 ? "+" : "") + (a.uncertainty - s.uncertainty).toFixed(3).padEnd(6)} ${(a.thoroughness - s.thoroughness >= 0 ? "+" : "") + (a.thoroughness - s.thoroughness).toFixed(3).padEnd(5)} ${(a.honestFlags - s.honestFlags >= 0 ? "+" : "") + (a.honestFlags - s.honestFlags).toFixed(2).padEnd(6)} ${(a.latency - s.latency >= 0 ? "+" : "") + (a.latency - s.latency).toFixed(0).padEnd(5)} ${(a.tokens - s.tokens >= 0 ? "+" : "") + (a.tokens - s.tokens).toFixed(0).padEnd(5)}`)
    }
  }

  // Honesty-specific: which mode produces most "I don't know" / uncertainty flags
  console.log(`\n=== Honesty signals (lower = more confident = potentially more hallucination) ===`)
  for (const mode of allModes) {
    const r = byMode[mode]
    const admits = mean(r.map(x => x.admitsUncertainty || 0))
    const flags = mean(r.map(x => x.honestyFlags || 0))
    console.log(`${mode.padEnd(14)} admits=${admits.toFixed(2)} flags=${flags.toFixed(2)}`)
  }

  // Combined with v3 data if available
  try {
    const v3Lines = readFileSync(join(HOME, ".claude", "experiment-v3-results.jsonl"), "utf-8").trim().split("\n").filter(Boolean)
    const v3Results = v3Lines.map(l => JSON.parse(l)).filter(r => r.ok !== false)
    console.log(`\n=== Combined v3 + v4 — all modes ranked ===`)
    const v3map = {}
    for (const r of v3Results) {
      const m = r.variant
      if (!v3map[m]) v3map[m] = []
      v3map[m].push(r)
    }
    for (const [mode, vals] of Object.entries(v3map)) {
      if (!aggs[mode]) aggs[mode] = { combined: mean(vals.map(v => v.combined)), evidence: mean(vals.map(v => v.evidenceDepth || 0)), hypothesis: mean(vals.map(v => v.hypothesisCoverage || 0)), uncertainty: mean(vals.map(v => v.uncertaintyDisc || 0)), thoroughness: mean(vals.map(v => v.thoroughness || 0)), tokens: mean(vals.map(v => (v.tokensIn||0) + (v.tokensOut||0))), latency: mean(vals.map(v => v.latency || 0)), honestyFlags: 0, n: vals.length }
    }
    const allModesSorted = Object.entries(aggs).sort((a, b) => b[1].combined - a[1].combined)
    for (const [mode, a] of allModesSorted) {
      console.log(`${mode.padEnd(14)} comb=${a.combined.toFixed(4)} ev=${a.evidence.toFixed(3)} hyp=${a.hypothesis.toFixed(3)} unc=${a.uncertainty.toFixed(3)} tho=${a.thoroughness.toFixed(3)} tok=${a.tokens.toFixed(0)}${aggs[mode]?.n ? ' n='+a.n : ''}`)
    }
  } catch {}

  // Write report
  const report = { meta: { experiment: "v4: prompt keyword patterns", scenarios: SCENARIOS.length, modes: allModes, calls: total }, results: aggs }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nReport: ${REPORT_PATH}`)
}

main().catch(err => { console.error(err); process.exit(1) })
