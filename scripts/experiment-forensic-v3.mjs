#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// v3: All dynamic injection variants (FORENSIC, SPEED, WEB-RESEARCH, QUALITY, STATIC)
// Parallel execution (5 concurrent) for fast results

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const RESULTS_LOG = join(HOME, ".claude", "experiment-v3-results.jsonl")
const REPORT_DIR = join(HOME, ".claude", "reports")
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z"
const REPORT_PATH = join(REPORT_DIR, `experiment-v3-all-modes-${ts}.json`)

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("FATAL: DEEPSEEK_API_KEY not set"); process.exit(1) }

const CONCURRENCY = 5

// Same 31 scenarios as v2
const SCENARIOS = [
  { id: "api-authenticate",       domain: "api",      complexity: "medium", prompt: "Create an Express.js auth middleware in TypeScript that validates JWT tokens from the Authorization header, attaches user ID to req.user, returns 401 if missing/expired/invalid. Include proper types and error handling." },
  { id: "refactor-extract-fn",    domain: "refactor", complexity: "medium", prompt: "Refactor this TypeScript function by extracting validation and formatting into separate pure functions while preserving the public API:\nfunction processOrder(order: { items: { price: number; qty: number }[]; tax: number; discount: number }): string {\n  if (!order.items || !Array.isArray(order.items)) throw new Error('Invalid items');\n  if (order.items.length === 0) throw new Error('No items');\n  if (typeof order.tax !== 'number' || order.tax < 0) throw new Error('Invalid tax');\n  let subtotal = 0;\n  for (const item of order.items) {\n    if (typeof item.price !== 'number' || item.price < 0) throw new Error('Invalid price');\n    if (typeof item.qty !== 'number' || item.qty < 0) throw new Error('Invalid qty');\n    subtotal += item.price * item.qty;\n  }\n  const total = subtotal + subtotal * order.tax - order.discount;\n  return '$' + total.toFixed(2);\n}" },
  { id: "api-rate-limiter",        domain: "api",      complexity: "hard",   prompt: "Implement a sliding window rate limiter for Express.js in TypeScript: 1) limit N requests per window per IP, 2) in-memory Map store, 3) return 429 with Retry-After, 4) auto-cleanup expired entries, 5) export as createRateLimiter(windowMs, maxRequests). Include comprehensive tests." },
  { id: "arch-rest-api-tasks",     domain: "arch",     complexity: "hard",   prompt: "Design a multi-file REST API for a task manager in TypeScript. Files: types.ts (Task interface), store.ts (in-memory TaskStore with async CRUD + crypto.randomUUID()), middleware/validateTask.ts (validate title 3-200 chars, status, priority), routes.ts (Express Router: GET/POST/PATCH/DELETE /tasks), app.ts (Express app, CORS, error handler). Return ALL 5 complete files." },
  { id: "systems-task-runner",     domain: "systems",  complexity: "hard",   prompt: "Implement a concurrent task runner in TypeScript: accept async tasks + concurrency limit N, run N simultaneously via semaphore, collect results in order, cancel remaining on reject, support AbortSignal, TaskRunner class with run/cancel/status(). Use generics TaskRunner<T>. Include tests for all edge cases." },
  { id: "refactor-monolith-split", domain: "refactor", complexity: "hard",   prompt: "Split this monolith into models/user.ts, utils/validation.ts, repositories/userRepository.ts, services/userService.ts. The monolith has User interface, 3 validators, 5 DB functions, 4 service functions. Preserve ALL behavior, proper imports/exports. Return 4 files." },
  { id: "arch-state-machine",      domain: "arch",     complexity: "hard",   prompt: "Implement a type-safe finite state machine in TypeScript. Generic over S (string) and E (string). Accept transitions map Record<S, Partial<Record<E, S>>>. Methods: transition(event), can(event), onEnter/onExit/onTransition callbacks, getHistory(), reset(), getState(). TypeScript must catch invalid state/event at compile time." },
  { id: "algorithm-dijkstra",      domain: "algorithm",complexity: "hard",   prompt: "Implement Dijkstra's shortest path in TypeScript. Accept adjacency list Map<string, Array<{node: string; weight: number}>>. Return {path: string[], distance: number} | null. Use BinaryHeap (implement yourself). Handle: empty graph, start=end, disconnected, negative weights (throw), cycles. Generics BinaryHeap<T>. JSDoc." },
  { id: "short-qa-tcp-udp",       domain: "general",  complexity: "easy",   prompt: "What is the difference between TCP and UDP? Answer in 2-3 sentences." },
  { id: "medium-explain-raft",    domain: "arch",     complexity: "medium", prompt: "Explain how a distributed consensus algorithm like Raft works. Include leader election, log replication, and safety properties. Write ~500 words." },
  { id: "short-math-primes",      domain: "algorithm",complexity: "easy",   prompt: "Calculate the sum of all prime numbers between 1 and 100. Show your work." },
  { id: "medium-architecture-docs",domain: "arch",    complexity: "medium", prompt: "Design the architecture for a real-time collaborative document editor (like Google Docs). Cover: OT vs CRDT, WebSocket mesh, persistence, conflict resolution, cursor sync. ~500 words." },
  { id: "long-codegen-lru",       domain: "systems",  complexity: "hard",   prompt: "Implement a complete LRU cache in TypeScript with generics, O(1) get/put, expiration TTL, event emitter for evictions, and comprehensive error handling. Include JSDoc. ~200 lines." },
  { id: "long-api-design-saas",   domain: "api",      complexity: "hard",   prompt: "Design a complete REST API for a multi-tenant SaaS platform. Include: JWT auth, RBAC with 3 roles, CRUD for 4 entities, rate limiting, pagination, soft delete, audit logging, webhooks." },
  { id: "race-condition-debug",       domain: "debug",    complexity: "hard", prompt: "Analyze this TypeScript code for race conditions. Identify ALL race conditions, explain the exact execution sequence that causes each one, and provide a corrected version." },
  { id: "security-vuln-audit",       domain: "security",  complexity: "hard", prompt: "Audit this TypeScript Express app for ALL security vulnerabilities. For each: attack vector, impact, fixed code. Consider: SQL injection, XSS, CSRF, prototype pollution, path traversal, SSRF, command injection." },
  { id: "production-incident-rca",   domain: "debug",    complexity: "hard", prompt: "A production incident: users get intermittent 500 errors during peak hours. Error logs show 'ETIMEDOUT' from payment gateway and 'ECONNRESET' from DB. Architecture: Node.js API -> PostgreSQL (pool:10) -> Stripe. Nginx 30s timeout. Analyze root cause." },
  { id: "architectural-tradeoff",    domain: "arch",     complexity: "hard", prompt: "Design an event ingestion pipeline for 50k events/sec. Evaluate 3 approaches: A) Kafka->Flink->S3, B) RabbitMQ->Node->PostgreSQL, C) Kinesis->Lambda->DynamoDB. Compare throughput, consistency, cost, latency, failure modes." },
  { id: "memory-leak-investigation", domain: "debug",    complexity: "hard", prompt: "A Node.js process grows to 2GB RSS after 24h and gets OOM-killed. Heap snapshot shows 800k RequestHandler instances. Find ALL memory leaks, trace GC root paths, provide fixes." },
  { id: "code-review-security",      domain: "audit",    complexity: "hard", prompt: "Code review a payment processing module. Find ALL bugs, security issues, anti-patterns. Classify as CRITICAL/HIGH/MEDIUM/LOW. For each: impact, exploit scenario, fix." },
  { id: "performance-bottleneck",    domain: "systems",  complexity: "hard", prompt: "Diagnose the bottleneck in a data pipeline processing 100k records in 45s. Each record does: API enrich -> schema validate -> transform -> DB insert. Find ALL bottlenecks, explain root cause, provide optimized code." },
  { id: "compiler-error-chain",      domain: "debug",    complexity: "hard", prompt: "Trace this TypeScript compiler error chain: 'Type string | undefined is not assignable to type string'. The actual root cause is deeper. Trace through ALL intermediate types, generics, and conditional types." },
  { id: "refactor-preserve-behavior",domain: "arch",     complexity: "hard", prompt: "Refactor callback-based code to async/await preserving exact behavior including error propagation, timing, and edge cases. For every transformation, explain WHY behavior is preserved." },
  { id: "api-conflicting-requirements",domain:"arch",    complexity:"hard", prompt:"Design an API that reconciles: paginated + filtered + sorted results on 10M rows, <200ms P99, computed fields, activity summaries. Must NOT expose raw DB queries. Support REST + GraphQL. Cache aggressively." },
  { id: "concurrency-deadlock",      domain: "debug",    complexity: "hard", prompt: "Analyze this TypeScript code for ALL deadlock scenarios. For each: exact thread interleaving, why it's deadlock (not livelock/starvation), the fix." },
  { id: "data-integrity-violation", domain: "security", complexity: "hard", prompt: "Analyze an order processing system for data integrity violations. For each: exact race condition or edge case, resulting data corruption, how to fix it." },
  { id: "dependency-conflict",       domain: "systems",  complexity: "hard", prompt: "A monorepo has 3 packages with conflicting dependency versions (react 17 vs 18, react-router 5 vs 6). Analyze conflict matrix, hoisting strategies for npm/yarn/pnpm, recommend best resolution." },
  { id: "auth-flow-audit",            domain: "security", complexity: "hard", prompt: "Audit this authentication flow for ALL vulnerabilities and logic flaws. For each: attack scenario, impact, fix." },
  { id: "state-corruption-analysis", domain: "debug",    complexity: "hard", prompt: "A React app has state corruption where UI shows stale data after navigation. Trace exact data flow through global state store, find ALL root causes." },
  { id: "distributed-system-failure", domain: "systems",  complexity: "hard", prompt: "Service A->B->C->D chain fails intermittently with 'context deadline exceeded', 'broken pipe', 'connection refused' during peak hours. Diagnose each symptom's root cause." },
  { id: "deployment-rollback-analysis",domain:"audit",   complexity:"hard", prompt:"A deployment caused partial outage. Rollback made it worse (wrong version). Analyze timeline, primary root cause, secondary factors, rollback process failure, monitoring gaps, process improvements." },
].map((s, i) => ({ ...s, order: i }))

const FORENSIC_DOMAINS = new Set(["debug", "security", "audit", "arch"])

// === Mode-specific directives ===
const MODE_DIRECTIVES = {
  forensic: [
    "[mode: forensic] This response uses FORENSIC analysis depth:",
    "- Evidence-based: trace each decision and claim to its justification",
    "- Multi-hypothesis: consider 2+ competing explanations before converging",
    "- Explicit uncertainty: flag assumptions, trade-offs, limitations",
    "- Structured output: clear sections with reasoning traces",
    "- Thorough verification: validate all edge cases and failure modes",
  ].join(" "),

  speed: [
    "[mode: speed] This response prioritizes SPEED and conciseness:",
    "- Direct answer first, context second",
    "- Minimize analysis depth — focus on actionable output",
    "- Skip exploratory alternatives unless critical",
    "- Keep output short and focused",
  ].join(" "),

  "web-research": [
    "[mode: exploration] This response uses exploration-first approach:",
    "- Gather information from multiple angles before converging",
    "- Document alternative approaches found during research",
    "- Flag confidence levels for each finding",
    "- Synthesize findings into actionable recommendations",
  ].join(" "),

  quality: [
    "[mode: quality] This response prioritizes QUALITY and thoroughness:",
    "- Full analysis depth with complete reasoning",
    "- Exhaustive edge case coverage",
    "- Comprehensive error handling and validation",
    "- Production-grade code with full test coverage",
    "- Complete documentation and type annotations",
  ].join(" "),

  static: null, // no extra directive
}

const STATIC_BASE = [
  "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
  "[batch execution] When running multiple independent operations, invoke them ALL in parallel.",
  "[project guard] AGENTS.md and README.md are protected. Do NOT modify without permission.",
  "[orchestrator] Delegate implementation work to Task subagents. Your role: verify and synthesize.",
  "[code quality] Write production-grade code with proper error handling, types, and tests.",
].join("\n")

function buildSystemPrompt(mode, scenario) {
  const base = STATIC_BASE
  const directive = MODE_DIRECTIVES[mode]
  // FORENSIC mode is only triggered for its target domains
  if (mode === "forensic" && !FORENSIC_DOMAINS.has(scenario.domain)) return base
  // Other modes apply to all scenarios
  if (directive) return base + "\n\n" + directive
  return base
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
  } catch (e) {
    return { ok: false, elapsed: Date.now() - start, error: e.message }
  }
}

function forensicMetrics(text) {
  if (!text) return { evidenceDepth:0, hypothesisCoverage:0, uncertaintyDisc:0, structuredOutput:0, thoroughness:0 }
  const l = text.toLowerCase()
  return {
    evidenceDepth: Math.min(1, (l.match(/because|since|therefore|implies?|leads?\s+to|traced?\s+to|evidence|prove[ds]?|shown?\s+by|demonstrat|result[eds]?\s+from|follows?\s+from|consequently/g) || []).length / 12),
    hypothesisCoverage: Math.min(1, (l.match(/alternativ|hypothes[ei]s|possibility|could\s+be|might\s+be|scenario|consider|approach\s+\d|option\s+\d|candidate|maybe|perhaps|potentially|another\s+(way|approach|path|reason|cause)/g) || []).length / 10),
    uncertaintyDisc: Math.min(1, (l.match(/unknown|uncertain|ambiguous|assumption|trade-?off|limitation|depends?\s+on|not\s+clear|not\s+sure|unclear|insufficient|incomplete|need\s+(more|further)|open\s+question|potential\s+risk|downside|caution/g) || []).length / 9),
    structuredOutput: Math.min(1, (text.match(/^\d+[\.\)]|^#{1,3}\s|^[-*]\s|^[A-Z][a-z]+:|^###|^##|^> /gm) || []).length / 7),
    thoroughness: Math.min(1, (l.match(/verify|validat|edge\s+case|error\s+(path|handl|case)|failur|except|corner\s+case|boundary|null\s+check|undefin|empty|safe\s+guard|fallback|recovery|rollback/g) || []).length / 10),
  }
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
  if (/async\s+/.test(text) && /await/.test(l)) c += 0.05
  if (/function|class|const|let|var/.test(text)) comp += 0.15
  if (/export\s+(default\s+)?(function|class|const)/.test(text)) comp += 0.15
  if (/: (string|number|boolean|void|any|never|Promise|Record|Partial|Pick)\b/.test(text)) comp += 0.1
  if (/import/.test(text)) comp += 0.1
  if (/@param|@returns|JSDoc| \* /.test(text)) comp += 0.1
  if (/test|describe|it\s*\(/.test(l)) comp += 0.15
  if (/\| .+ \|/.test(text)) comp += 0.05
  if (/^#{1,3}\s/.test(text)) comp += 0.05
  if (/eval\s*\(/.test(text)) s -= 0.3
  if (/process\.exit/.test(text) && !/test/i.test(text)) s -= 0.1
  if (/new\s+Function/.test(text)) s -= 0.2
  if (/innerHTML/.test(text)) s -= 0.1
  s = Math.max(0, Math.min(1, s))
  return { correctness: Math.min(1, c), completeness: Math.min(1, comp), safety: s, combined: c + comp + s, wordCount: text.split(/\s+/).length }
}

function logResult(e) { appendFileSync(RESULTS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n") }

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true })
  const MODES = ["static", "forensic", "speed", "web-research", "quality"]
  const total = SCENARIOS.length * MODES.length
  const directions = ["Write a thorough response.", "Be comprehensive.", "Provide complete analysis.", "Include as much detail as possible."]

  console.log(`=== v3: All injection variants ===`)
  console.log(`Scenarios: ${SCENARIOS.length}, Modes: ${MODES.length}, Total calls: ${total}`)
  console.log(`Concurrency: ${CONCURRENCY}, Log: ${RESULTS_LOG}\n`)

  // Build task queue
  const tasks = []
  for (let runIdx = 0; runIdx < 2; runIdx++) {
    for (const sc of SCENARIOS) {
      for (const mode of MODES) {
        const systemPrompt = buildSystemPrompt(mode, sc)
        const userPrompt = sc.prompt + "\n\n" + directions[(runIdx + sc.order) % directions.length]
        tasks.push({ sc, mode, systemPrompt, userPrompt, runIdx })
      }
    }
  }

  // Shuffle tasks to avoid bias from order
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tasks[i], tasks[j]] = [tasks[j], tasks[i]]
  }

  let completed = 0
  const results = []

  async function worker(tasks) {
    for (const task of tasks) {
      const r = await callDeepSeek(task.systemPrompt, task.userPrompt)
      if (!r.ok) {
        logResult({ event: "v3", variant: task.mode, scenario: task.sc.id, complexity: task.sc.complexity, domain: task.sc.domain, run: task.runIdx, ok: false, error: r.error })
        completed++
        continue
      }
      const scores = scoreOutput(r.content)
      const fm = forensicMetrics(r.content)
      logResult({ event: "v3", variant: task.mode, scenario: task.sc.id, complexity: task.sc.complexity, domain: task.sc.domain, run: task.runIdx, ok: true, ...scores, ...fm, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: r.elapsed })
      results.push({ scenario: task.sc.id, domain: task.sc.domain, complexity: task.sc.complexity, variant: task.mode, run: task.runIdx, ...scores, ...fm })
      completed++
      if (completed % 10 === 0) process.stdout.write(`\r  Progress: ${completed}/${tasks.length} (${(completed/tasks.length*100).toFixed(0)}%)`)
    }
  }

  const workers = []
  const chunkSize = Math.ceil(tasks.length / CONCURRENCY)
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(tasks.slice(i * chunkSize, (i + 1) * chunkSize)))
  }
  await Promise.all(workers)

  process.stdout.write(`\r  Complete: ${completed}/${tasks.length}\n\n`)

  // ===== ANALYSIS =====
  const ok = results.filter(r => r.combined > 0)
  if (ok.length < 10) { console.log("Not enough data."); return }

  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  const allModes = [...new Set(ok.map(r => r.variant))]

  console.log(`\n${"MODE".padEnd(14)} ${"COMBINED".padEnd(10)} ${"CORRECT".padEnd(9)} ${"COMPLETE".padEnd(9)} ${"SAFETY".padEnd(8)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"LAT(ms)".padEnd(8)} ${"TOKEN".padEnd(6)}`)
  console.log("-".repeat(100))

  const modeAggs = {}
  for (const mode of allModes) {
    const r = ok.filter(x => x.variant === mode)
    const e = mean(r.map(x => x.evidenceDepth || 0))
    const h = mean(r.map(x => x.hypothesisCoverage || 0))
    const u = mean(r.map(x => x.uncertaintyDisc || 0))
    const t = mean(r.map(x => x.thoroughness || 0))
    const lat = mean(r.map(x => x.latency || 0))
    const tok = mean(r.map(x => (x.tokensIn || 0) + (x.tokensOut || 0)))
    const scores = { combined: mean(r.map(x => x.combined)), correctness: mean(r.map(x => x.correctness)), completeness: mean(r.map(x => x.completeness)), safety: mean(r.map(x => x.safety)) }
    modeAggs[mode] = { ...scores, evidence: e, hypothesis: h, uncertainty: u, thoroughness: t, latency: lat, tokens: tok }
    console.log(`${mode.padEnd(14)} ${scores.combined.toFixed(4).padEnd(10)} ${scores.correctness.toFixed(4).padEnd(9)} ${scores.completeness.toFixed(4).padEnd(9)} ${scores.safety.toFixed(4).padEnd(8)} ${e.toFixed(3).padEnd(6)} ${h.toFixed(3).padEnd(6)} ${u.toFixed(3).padEnd(7)} ${t.toFixed(3).padEnd(6)} ${lat.toFixed(0).padEnd(8)} ${tok.toFixed(0).padEnd(6)}`)
  }

  // Delta from static
  const staticBase = modeAggs["static"] || modeAggs["static"]
  if (staticBase) {
    console.log(`\n=== Delta from STATIC baseline ===`)
    console.log(`${"MODE".padEnd(14)} ${"COMBINED".padEnd(10)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"LAT".padEnd(6)}`)
    console.log("-".repeat(60))
    for (const mode of allModes.filter(m => m !== "static")) {
      const a = modeAggs[mode]
      console.log(`${mode.padEnd(14)} ${(a.combined - staticBase.combined >= 0 ? "+" : "") + (a.combined - staticBase.combined).toFixed(4).padEnd(9)} ${(a.evidence - staticBase.evidence >= 0 ? "+" : "") + (a.evidence - staticBase.evidence).toFixed(3).padEnd(5)} ${(a.hypothesis - staticBase.hypothesis >= 0 ? "+" : "") + (a.hypothesis - staticBase.hypothesis).toFixed(3).padEnd(5)} ${(a.uncertainty - staticBase.uncertainty >= 0 ? "+" : "") + (a.uncertainty - staticBase.uncertainty).toFixed(3).padEnd(6)} ${(a.thoroughness - staticBase.thoroughness >= 0 ? "+" : "") + (a.thoroughness - staticBase.thoroughness).toFixed(3).padEnd(5)} ${(a.latency - staticBase.latency >= 0 ? "+" : "") + (a.latency - staticBase.latency).toFixed(0).padEnd(5)}`)
    }
  }

  // By domain group for each mode
  console.log(`\n=== FORENSIC domains (debug/security/audit/arch) by mode ===`)
  console.log(`${"MODE".padEnd(14)} ${"COMBINED".padEnd(10)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)}`)
  console.log("-".repeat(45))
  for (const mode of allModes) {
    const r = ok.filter(x => x.variant === mode && FORENSIC_DOMAINS.has(x.domain))
    if (r.length < 2) continue
    console.log(`${mode.padEnd(14)} ${mean(r.map(x => x.combined)).toFixed(4).padEnd(10)} ${mean(r.map(x => x.evidenceDepth || 0)).toFixed(3).padEnd(6)} ${mean(r.map(x => x.hypothesisCoverage || 0)).toFixed(3).padEnd(6)} ${mean(r.map(x => x.uncertaintyDisc || 0)).toFixed(3).padEnd(7)} ${mean(r.map(x => x.thoroughness || 0)).toFixed(3).padEnd(6)}`)
  }

  // Verdict
  console.log(`\n=== SUMMARY ===`)
  const best = allModes.sort((a, b) => modeAggs[b].combined - modeAggs[a].combined)[0]
  console.log(`Best combined: ${best} (${modeAggs[best].combined.toFixed(4)})`)
  const bestF = allModes.sort((a, b) => {
    const af = modeAggs[a].evidence + modeAggs[a].hypothesis + modeAggs[a].uncertainty + modeAggs[a].thoroughness
    const bf = modeAggs[b].evidence + modeAggs[b].hypothesis + modeAggs[b].uncertainty + modeAggs[b].thoroughness
    return bf - af
  })[0]
  console.log(`Best forensic metrics: ${bestF} (F-sum=${(modeAggs[bestF].evidence + modeAggs[bestF].hypothesis + modeAggs[bestF].uncertainty + modeAggs[bestF].thoroughness).toFixed(3)})`)
  console.log(`Cheapest (tokens): ${allModes.sort((a, b) => modeAggs[a].tokens - modeAggs[b].tokens)[0]}`)
  console.log(`Fastest (latency): ${allModes.sort((a, b) => modeAggs[a].latency - modeAggs[b].latency)[0]}`)

  // Save report
  const report = { meta: { experiment: "v3: all injection variants", scenarios: SCENARIOS.length, modes: MODES, total_calls: tasks.length, successful: ok.length }, overall: modeAggs, by_domain: {} }
  for (const d of [...new Set(ok.map(r => r.domain))].sort()) {
    report.by_domain[d] = {}
    for (const mode of allModes) {
      const r = ok.filter(x => x.variant === mode && x.domain === d)
      if (r.length) report.by_domain[d][mode] = { combined: mean(r.map(x => x.combined)), evidence: mean(r.map(x => x.evidenceDepth || 0)), hypothesis: mean(r.map(x => x.hypothesisCoverage || 0)) }
    }
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nReport: ${REPORT_PATH}`)
}

main().catch(err => { console.error(err); process.exit(1) })
