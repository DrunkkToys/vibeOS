#!/usr/bin/env node
// v5: Creative prompt hypotheses — novel patterns that actually change model behavior
// ERROR_FIRST, DUELING_PERSONAS, RECURSIVE_CRITIQUE, META_COGNITION,
// RED_TEAM_BLUE_TEAM, NEGATIVE_SPACE, SCIENTIFIC_METHOD, OS_LEVEL_2, ANTI_GROKKING

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const RESULTS_LOG = join(HOME, ".vibeos", "experiment-v5-results.jsonl")
const REPORT_DIR = join(HOME, ".vibeos", "reports")
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("FATAL: DEEPSEEK_API_KEY not set"); process.exit(1) }

const CONCURRENCY = 5

const SCENARIOS = [
  { id: "api-authenticate",  domain: "api",      prompt: "Create an Express.js auth middleware in TypeScript that validates JWT tokens, attaches user ID to req.user, returns 401 if missing/expired/invalid." },
  { id: "api-rate-limiter",   domain: "api",      prompt: "Implement a sliding window rate limiter for Express.js in TypeScript. limit N req/window/IP, 429 with Retry-After, auto-cleanup." },
  { id: "arch-rest-api-tasks",domain: "arch",     prompt: "Design a multi-file REST API for a task manager: types.ts, store.ts (async CRUD), middleware, routes.ts, app.ts (Express, CORS, error handler)." },
  { id: "systems-task-runner",domain: "systems",  prompt: "Implement a concurrent task runner: async tasks + concurrency limit, semaphore, AbortSignal, TaskRunner<T> with run/cancel/status." },
  { id: "arch-state-machine", domain: "arch",     prompt: "Implement a type-safe FSM generic over S,E with transition, can, callbacks, getHistory, reset." },
  { id: "algorithm-dijkstra", domain: "algorithm",prompt: "Dijkstra with BinaryHeap. Handle empty, start=end, disconnected, negative weights. Generic BinaryHeap<T>." },
  { id: "medium-explain-raft",domain: "arch",     prompt: "Explain Raft consensus: leader election, log replication, safety properties. ~500 words." },
  { id: "long-codegen-lru",  domain: "systems",  prompt: "Implement LRU cache in TypeScript with generics, O(1) get/put, TTL, eviction events. ~200 lines." },
  { id: "long-api-design-saas",domain:"api",      prompt:"REST API for multi-tenant SaaS: JWT auth, RBAC (3 roles), CRUD (4 entities), rate limiting, pagination, webhooks."},
  { id: "race-condition-debug", domain:"debug",   prompt:"Analyze TypeScript code for ALL race conditions. Explain exact execution sequences. Provide corrected version."},
  { id: "security-vuln-audit",domain:"security",  prompt:"Audit Express app for ALL security vulns: SQL injection, XSS, CSRF, prototype pollution, SSRF, command injection."},
  { id: "production-rca",    domain:"debug",      prompt:"Production incident: 500 errors peak hours. ETIMEDOUT from payment, ECONNRESET from DB. Node.js -> PG -> Stripe. Root cause analysis."},
  { id: "arch-tradeoff",     domain:"arch",       prompt:"Event ingestion pipeline 50k/s. Compare Kafka->Flink->S3 vs RabbitMQ->Node->PG vs Kinesis->Lambda->DynamoDB."},
  { id: "memory-leak",       domain:"debug",      prompt:"Node.js OOM at 2GB after 24h. 800k RequestHandler instances. Find leaks, trace GC roots, fix."},
  { id: "code-review",       domain:"audit",      prompt:"Code review payment module. Find ALL bugs, security issues, anti-patterns. CRITICAL/HIGH/MEDIUM/LOW."},
  { id: "performance-bottle",domain:"systems",   prompt:"Data pipeline 100k records in 45s. API enrich -> validate -> transform -> DB insert. All bottlenecks, optimized code."},
  { id: "compiler-error",    domain:"debug",      prompt:"Trace 'Type string|undefined not assignable to string' through ALL intermediate generics and conditional types."},
  { id: "concurrency-deadlock",domain:"debug",   prompt:"Deadlock analysis: thread interleaving, why deadlock not livelock, the fix."},
  { id: "data-integrity",    domain:"security",   prompt:"Order processing: race conditions, data corruption, fix. Concurrent stock deduct + payment + fulfillment."},
  { id: "auth-flow",         domain:"security",   prompt:"Audit auth flow: login, session, admin endpoints, password reset. All vulns and logic flaws."},
  { id: "distributed-failure",domain:"systems",   prompt:"Service chain A->B->C->D. Intermittent: context deadline, broken pipe, conn refused peak hours. Diagnose."},
  { id: "deployment-postmortem",domain:"audit",  prompt:"Deployment caused partial outage. Rollback made it worse. Timeline, root cause, monitoring gaps."},
  { id: "refactor-callback", domain:"arch",       prompt:"Refactor callback-based code to async/await preserving exact error propagation and edge cases."},
  { id: "state-corruption",  domain:"debug",      prompt:"React app stale data after navigation. Global store, subscribers. Trace data flow, find root causes."},
  { id: "dependency-hell",   domain:"systems",    prompt:"Monorepo 3 packages conflicting react 17/18, router 5/6. Conflict matrix, hoisting, pnpm vs yarn vs npm."},
  { id: "short-qa",          domain:"general",    prompt:"TCP vs UDP difference? 2-3 sentences."},
  { id: "short-math",        domain:"algorithm",  prompt:"Sum of primes between 1 and 100. Show work."},
  { id: "refactor-monolith", domain:"refactor",   prompt:"Split monolith into models/, utils/, repositories/, services/. Preserve ALL behavior."},
  { id: "collab-editor-arch",domain:"arch",       prompt:"Design real-time collaborative editor. OT vs CRDT, WebSocket mesh, conflict resolution. ~500 words."},
  { id: "mid-arch-docs",     domain:"arch",       prompt:"Design real-time collab doc editor architecture. ~500 words."},
  { id: "conflicting-api",   domain:"arch",       prompt:"Design API: paginated + multi-filter + sort on 10M rows, <200ms P99, computed fields, REST+GraphQL."},
].map((s, i) => ({ ...s, order: i }))

const STATIC_BASE = [
  "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
  "[batch execution] When multiple independent operations, invoke in parallel.",
  "[code quality] Write production-grade code with error handling, types, tests.",
].join("\n")

const CREATIVE_MODES = {
  static: null,

  error_first: [
    "[instruction] First write the worst possible solution that has every bug you can think of. Enumerate each bug. Then write the corrected solution that fixes every single one. Show the delta between them.",
  ].join(" "),

  dueling_personas: [
    "[instruction] Simulate a debate between two senior engineers with opposing architectural views. Each states their position, counters the other, and identifies trade-offs. After the debate, synthesize a final answer that incorporates the strongest points from both.",
  ].join(" "),

  recursive_critique: [
    "[instruction] Generate your complete solution. Then, acting as a hostile code reviewer, critique every part of it — find every issue. Then produce a revised solution that addresses every critique. Each section must have: [solution] -> [critique] -> [revised].",
  ].join(" "),

  meta_cognition: [
    "[instruction] After each major section, write a meta-commentary in [brackets] about your own reasoning: what assumptions you made, what you're uncertain about, what alternative paths you considered and rejected, and what you might have missed.",
  ].join(" "),

  red_blue: [
    "[instruction] First, act as a RED TEAM: find every vulnerability, edge case, failure mode, and security issue in the requirements. Be ruthless. Then act as BLUE TEAM: implement the solution with every RED TEAM finding addressed. Structure: [RED TEAM analysis] -> [BLUE TEAM implementation addressed].",
  ].join(" "),

  negative_space: [
    "[instruction] After your solution, include a 'Negative Space' section listing: what you deliberately chose NOT to do and why, what approaches you rejected and the reasoning, what trade-offs you accepted and their cost. Documenting rejected paths is as important as the chosen one.",
  ].join(" "),

  scientific_method: [
    "[instruction] Use the scientific method: 1) HYPOTHESIS — state your approach and expected outcome. 2) EXPERIMENT DESIGN — plan your solution structure. 3) VERIFICATION — test your solution against known edge cases. 4) ANALYSIS — identify what works and what doesn't. 5) CONCLUSION — final answer with confidence level.",
  ].join(" "),

  os_level_2: [
    "[instruction] Use System-2 thinking: slow, deliberate, analytical. Before writing any code, restate the requirements in your own words to verify understanding. Then plan your approach. Only then implement. After implementation, verify against requirements. Show each step explicitly.",
  ].join(" "),

  anti_grokking: [
    "[instruction] Do NOT rely on memorized patterns or common solutions. Solve this from first principles. Before using any known approach, verify it's actually correct for THIS specific case. If you recognize a pattern, justify why it applies here rather than assuming. Flag any assumptions you're making.",
  ].join(" "),
}

function buildSystemPrompt(mode) {
  const d = CREATIVE_MODES[mode]
  return d ? STATIC_BASE + "\n\n" + d : STATIC_BASE
}

async function callDeepSeek(systemPrompt, userPrompt) {
  const start = Date.now()
  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
      body: JSON.stringify({ model: "deepseek-chat", messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], max_tokens: 8192 }),
    })
    const elapsed = Date.now() - start
    if (!resp.ok) return { ok: false, elapsed, error: resp.status }
    const data = await resp.json()
    const content = data.choices?.[0]?.message?.content || ""
    return { ok: true, elapsed, content, tokensIn: data.usage?.prompt_tokens || 0, tokensOut: data.usage?.completion_tokens || 0 }
  } catch (e) { return { ok: false, elapsed: Date.now() - start, error: e.message } }
}

function score(text) {
  if (!text) return { correctness:0, completeness:0, safety:0, combined:0, wc:0 }
  const l = text.toLowerCase()
  let c=0.3, comp=0, s=1
  for (const pat of [/error|throw|catch|try/i, /return|=>/, /function|class|interface/, /test|describe|it\s*\(/i, /\bPromise\b/, /async.*await/]) if (pat.test(text)) c+=0.1
  for (const pat of [/function|class|const|let|var/, /export\s+(default\s+)?(function|class|const)/, /:\s*(string|number|boolean|void|any|Promise|Record|Partial|Pick)\b/, /import/, /@param|@returns|JSDoc/, /test|describe|it\s*\(/i]) if (pat.test(text)) comp+=0.1
  if (/eval\s*\(/.test(text)) s-=0.3
  if (/process\.exit/.test(text) && !/test/i.test(text)) s-=0.1
  if (/new\s+Function/.test(text)) s-=0.2
  s=Math.max(0,Math.min(1,s))
  return { correctness: Math.min(1,c), completeness: Math.min(1,comp), safety: s, combined: c+comp+s, wc: text.split(/\s+/).length }
}

function fm(text) {
  if (!text) return { ev:0, hyp:0, unc:0, so:0, tho:0 }
  const l = text.toLowerCase()
  return {
    ev: Math.min(1, (l.match(/because|since|therefore|implies?|evidence|demonstrat|consequently|leads?\s+to|traced?\s+to/g)||[]).length/12),
    hyp: Math.min(1, (l.match(/alternativ|hypothes[ei]s|possibility|could\s+be|might\s+be|scenario|consider|approach|maybe|perhaps/g)||[]).length/10),
    unc: Math.min(1, (l.match(/unknown|uncertain|ambiguous|assumption|trade-?off|limitation|not\s+clear|unclear|insufficient|incomplete/g)||[]).length/9),
    so: Math.min(1, (text.match(/^\d+[\.\)]|^#{1,3}\s|^[-*]\s|^[A-Z][a-z]+:|^###/gm)||[]).length/7),
    tho: Math.min(1, (l.match(/verify|validat|edge\s+case|error\s+(path|handl|case)|failur|except|null\s+check|fallback|recovery|rollback/g)||[]).length/10),
  }
}

function log(e) { appendFileSync(RESULTS_LOG, JSON.stringify({ts:new Date().toISOString(),...e})+"\n") }

async function main() {
  mkdirSync(REPORT_DIR, {recursive:true})
  const MODES = Object.keys(CREATIVE_MODES)
  const total = SCENARIOS.length * MODES.length

  console.log(`=== v5: Creative prompt hypotheses ===`)
  console.log(`Modes (${MODES.length}): ${MODES.join(", ")}`)
  console.log(`Scenarios: ${SCENARIOS.length}, Calls: ${total}, Concurrency: ${CONCURRENCY}\n`)

  const tasks = []
  for (const sc of SCENARIOS)
    for (const mode of MODES)
      tasks.push({ sc, mode, sp: buildSystemPrompt(mode), up: sc.prompt + "\n\nBe thorough." })

  for (let i = tasks.length-1; i > 0; i--) { const j=Math.floor(Math.random()*(i+1)); [tasks[i],tasks[j]]=[tasks[j],tasks[i]] }

  let done = 0
  const results = []

  async function worker(slice) {
    for (const t of slice) {
      const r = await callDeepSeek(t.sp, t.up)
      const base = { variant: t.mode, scenario: t.sc.id, domain: t.sc.domain }
      if (!r.ok) { log({event:"v5",...base,ok:false,error:r.error}); done++; continue }
      const sc = score(r.content), m = fm(r.content)
      log({event:"v5",...base,ok:true,...sc,...m,tokIn:r.tokensIn,tokOut:r.tokensOut,lat:r.elapsed})
      results.push({...base,...sc,...m,tok:r.tokensIn+r.tokensOut,lat:r.elapsed})
      done++
      if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} (${(done/total*100).toFixed(0)}%)`)
    }
  }

  const cs = Math.ceil(tasks.length / CONCURRENCY)
  await Promise.all(Array.from({length:CONCURRENCY}, (_,i) => worker(tasks.slice(i*cs,(i+1)*cs))))
  process.stdout.write("\n\n")

  // ===== MERGE ALL EXPERIMENTS AND GENERATE FINAL REPORT =====
  const ok = results.filter(r => r.combined > 0)
  const mean = arr => arr.length ? arr.reduce((s,v) => s+v,0) / arr.length : 0

  // Load v3 data (mode directives)
  const v3Data = []
  try {
    const lines = readFileSync(join(HOME,".vibeos","experiment-v3-results.jsonl"),"utf-8").trim().split("\n").filter(Boolean)
    for (const l of lines) {
      const r = JSON.parse(l)
      if (r.ok !== false && r.combined) v3Data.push({
        variant: r.variant, scenario: r.scenario, domain: r.domain,
        combined: r.combined, correctness: r.correctness, completeness: r.completeness, safety: r.safety,
        ev: r.evidenceDepth||0, hyp: r.hypothesisCoverage||0, unc: r.uncertaintyDisc||0,
        so: r.structuredOutput||0, tho: r.thoroughness||0,
        tok: (r.tokensIn||0)+(r.tokensOut||0), lat: r.latency||0,
      })
    }
  } catch {}

  // Merge v3 + v5
  const all = [...v3Data, ...ok.map(r => ({
    variant: r.variant, scenario: r.scenario, domain: r.domain,
    combined: r.combined, correctness: r.correctness, completeness: r.completeness, safety: r.safety,
    ev: r.ev||0, hyp: r.hyp||0, unc: r.unc||0, so: r.so||0, tho: r.tho||0,
    tok: r.tok||0, lat: r.lat||0,
  }))]

  const byMode = {}
  for (const r of all) {
    if (!byMode[r.variant]) byMode[r.variant] = []
    byMode[r.variant].push(r)
  }

  const modes = Object.keys(byMode).sort()
  const aggs = {}
  for (const mode of modes) {
    const r = byMode[mode]
    aggs[mode] = {
      n: r.length,
      combined: mean(r.map(x=>x.combined)),
      correctness: mean(r.map(x=>x.correctness)),
      completeness: mean(r.map(x=>x.completeness)),
      safety: mean(r.map(x=>x.safety)),
      ev: mean(r.map(x=>x.ev)),
      hyp: mean(r.map(x=>x.hyp)),
      unc: mean(r.map(x=>x.unc)),
      so: mean(r.map(x=>x.so)),
      tho: mean(r.map(x=>x.tho)),
      tok: mean(r.map(x=>x.tok)),
      lat: mean(r.map(x=>x.lat)),
    }
  }

  // ===== FINAL RANKED OUTPUT =====
  console.log("=".repeat(120))
  console.log("FINAL REPORT: ALL PROMPT INJECTION HYPOTHESES — RANKED")
  console.log("=".repeat(120))

  const ranked = Object.entries(aggs).sort((a,b) => b[1].combined - a[1].combined)

  console.log(`\n${"#".padEnd(3)} ${"MODE".padEnd(18)} ${"n".padEnd(4)} ${"COMBINED".padEnd(10)} ${"CORR".padEnd(7)} ${"COMP".padEnd(7)} ${"SAFE".padEnd(6)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"STRUCT".padEnd(7)} ${"TOK".padEnd(6)} ${"LAT".padEnd(6)}`)
  console.log("-".repeat(120))

  const baseline = aggs["static"]
  for (let idx = 0; idx < ranked.length; idx++) {
    const [mode, a] = ranked[idx]
    const delta = baseline ? (a.combined - baseline.combined).toFixed(4) : "-"
    const dE = baseline && a.ev && baseline.ev ? ((a.ev - baseline.ev) >= 0 ? "+" : "") + (a.ev - baseline.ev).toFixed(3) : "-"
    const dH = baseline && a.hyp && baseline.hyp ? ((a.hyp - baseline.hyp) >= 0 ? "+" : "") + (a.hyp - baseline.hyp).toFixed(3) : "-"
    const dU = baseline && a.unc && baseline.unc ? ((a.unc - baseline.unc) >= 0 ? "+" : "") + (a.unc - baseline.unc).toFixed(3) : "-"
    const label = idx === 0 ? "<<BEST" : delta > 0.05 ? "WIN " : delta < -0.05 ? "LOSE" : "TIED"
    console.log(`${(idx+1).toString().padEnd(3)} ${mode.padEnd(18)} ${a.n.toString().padEnd(4)} ${a.combined.toFixed(4).padEnd(10)} ${a.correctness.toFixed(4).padEnd(7)} ${a.completeness.toFixed(4).padEnd(7)} ${a.safety.toFixed(4).padEnd(6)} ${(a.ev||0).toFixed(3).padEnd(6)} ${(a.hyp||0).toFixed(3).padEnd(6)} ${(a.unc||0).toFixed(3).padEnd(7)} ${(a.tho||0).toFixed(3).padEnd(6)} ${(a.so||0).toFixed(3).padEnd(7)} ${(a.tok||0).toFixed(0).padEnd(6)} ${(a.lat||0).toFixed(0).padEnd(6)} ${label} Δ=${delta} ev=${dE} hyp=${dH} unc=${dU}`)
  }

  // ===== KPIs =====
  console.log(`\n\n${"=".repeat(120)}`)
  console.log("KEY PERFORMANCE INDICATORS")
  console.log("=".repeat(120))

  // 1. Best combined score
  const best = ranked[0]
  const worst = ranked[ranked.length-1]
  const staticR = aggs["static"]
  console.log(`\n1. BEST OVERALL: "${best[0]}" (${best[1].combined.toFixed(4)})`)
  console.log(`   Static baseline: ${staticR.combined.toFixed(4)}`)
  console.log(`   Delta: +${(best[1].combined - staticR.combined).toFixed(4)}`)
  console.log(`   Strengths: ev=${best[1].ev.toFixed(3)} hyp=${best[1].hyp.toFixed(3)} tho=${best[1].tho.toFixed(3)}`)

  // 2. Best for each KPI
  const kpis = {
    "Correctness": "correctness",
    "Completeness": "completeness",
    "Safety": "safety",
    "Evidence depth": "ev",
    "Hypothesis coverage": "hyp",
    "Uncertainty disclosure": "unc",
    "Thoroughness": "tho",
    "Structured output": "so",
  }
  console.log(`\n2. BEST FOR EACH KPI:`)
  for (const [label, key] of Object.entries(kpis)) {
    const sorted = Object.entries(aggs).sort((a,b) => (b[1][key]||0) - (a[1][key]||0))
    const [bestMode, bestVal] = sorted[0]
    console.log(`   ${label.padEnd(22)} = "${bestMode}" (${(bestVal[key]||0).toFixed(4)})`)
  }

  // 3. Cost efficiency
  console.log(`\n3. TOKEN EFFICIENCY (tokens per combined point):`)
  const tokEff = Object.entries(aggs).map(([m,a]) => [m, a.tok / (a.combined || 1)])
    .sort((a,b) => a[1] - b[1])
  for (const [m, eff] of tokEff) {
    const baselineEff = staticR.tok / (staticR.combined || 1)
    const diff = ((baselineEff - eff) / baselineEff * 100).toFixed(1)
    console.log(`   ${m.padEnd(18)} ${eff.toFixed(0)} tok/pt ${diff > 0 ? "+" : ""}${diff}% vs static`)
  }

  // 4. Ranked by each creative hypothesis category
  console.log(`\n4. CREATIVE HYPOTHESES RANKED (v5 only):`)
  const v5Modes = Object.keys(CREATIVE_MODES).filter(m => m !== "static")
  for (const mode of v5Modes) {
    const a = aggs[mode]
    const rank = ranked.findIndex(([m]) => m === mode) + 1
    console.log(`   #${rank.toString().padEnd(3)} ${mode.padEnd(20)} comb=${a.combined.toFixed(4)} hyp=${(a.hyp||0).toFixed(3)} unc=${(a.unc||0).toFixed(3)} tho=${(a.tho||0).toFixed(3)} tok=${(a.tok||0).toFixed(0)}`)
  }

  // 5. Mode directives ranked (v3)
  console.log(`\n5. MODE DIRECTIVES RANKED (v3):`)
  const v3Modes = ["static","forensic","speed","web-research","quality"]
  for (const mode of v3Modes) {
    const a = aggs[mode]
    if (!a) continue
    const rank = ranked.findIndex(([m]) => m === mode) + 1
    console.log(`   #${rank.toString().padEnd(3)} ${mode.padEnd(14)} comb=${a.combined.toFixed(4)} ev=${(a.ev||0).toFixed(3)} hyp=${(a.hyp||0).toFixed(3)} unc=${(a.unc||0).toFixed(3)} tho=${(a.tho||0).toFixed(3)} tok=${(a.tok||0).toFixed(0)}`)
  }

  // 6. Budget / speed analysis
  console.log(`\n6. SPEED vs QUALITY TRADE-OFF:`)
  const speedA = aggs["speed"]
  const qualityA = aggs["quality"]
  if (speedA && qualityA) {
    console.log(`   Speed:   ${speedA.combined.toFixed(4)} at ${speedA.tok.toFixed(0)} tok (${speedA.lat.toFixed(0)}ms)`)
    console.log(`   Quality: ${qualityA.combined.toFixed(4)} at ${qualityA.tok.toFixed(0)} tok (${qualityA.lat.toFixed(0)}ms)`)
    console.log(`   Quality gives +${(qualityA.combined - speedA.combined).toFixed(4)} combined for ${((qualityA.tok - speedA.tok) / speedA.tok * 100).toFixed(0)}% more tokens`)
  }

  // 7. Honesty signals from v5
  console.log(`\n7. NOVELTY — which modes changed behavior most vs static:`)
  const deltas = Object.entries(aggs).map(([m,a]) => {
    if (m === "static" || !staticR) return null
    const d = a.combined - staticR.combined
    const dE = (a.ev||0) - (staticR.ev||0)
    const dH = (a.hyp||0) - (staticR.hyp||0)
    const dU = (a.unc||0) - (staticR.unc||0)
    return { mode: m, d, dE, dH, dU, magnitude: Math.abs(d) + Math.abs(dE) + Math.abs(dH) + Math.abs(dU) }
  }).filter(Boolean).sort((a,b) => b.magnitude - a.magnitude)
  for (const item of deltas.slice(0,10)) {
    console.log(`   ${item.mode.padEnd(20)} Δcomb=${(item.d >= 0 ? "+" : "") + item.d.toFixed(4)} ev=${(item.dE >= 0 ? "+" : "") + item.dE.toFixed(3)} hyp=${(item.dH >= 0 ? "+" : "") + item.dH.toFixed(3)} unc=${(item.dU >= 0 ? "+" : "") + item.dU.toFixed(3)}`)
  }

  // 8. Winning insight
  const top3 = ranked.slice(0, 3).map(([m]) => m)
  const bottom3 = ranked.slice(-3).map(([m]) => m)
  console.log(`\n8. CONCLUSIONS:`)
  console.log(`   Top 3: ${top3.join(", ")}`)
  console.log(`   Bottom 3: ${bottom3.join(", ")}`)
  const topDelta = ranked[0][1].combined - staticR.combined
  console.log(`   Best improvement over static: +${topDelta.toFixed(4)} (${((topDelta / staticR.combined) * 100).toFixed(1)}%)`)
  console.log(`   Strongest forensic signal: "${ranked.sort((a,b) => (b[1].hyp||0) - (a[1].hyp||0))[0][0]}" (hypothesis coverage)`)
  console.log(`   Most thorough: "${ranked.sort((a,b) => (b[1].tho||0) - (a[1].tho||0))[0][0]}"`)

  // Save final report
  const finalReport = {
    meta: {
      generated_at: new Date().toISOString(),
      experiments_merged: ["v3 (mode directives)", "v5 (creative hypotheses)"],
      total_data_points: all.length,
      modes_tested: modes.length,
      static_baseline_combined: staticR.combined,
    },
    ranking: ranked.map(([m,a], i) => ({
      rank: i+1, mode: m, ...a,
    })),
    kpis: Object.entries(kpis).map(([label, key]) => ({
      kpi: label,
      winner: Object.entries(aggs).sort((a,b) => (b[1][key]||0) - (a[1][key]||0))[0][0],
      value: Object.entries(aggs).sort((a,b) => (b[1][key]||0) - (a[1][key]||0))[0][1][key],
    })),
    conclusions: {
      best_overall: top3,
      worst_overall: bottom3,
      best_improvement_pct: ((topDelta / staticR.combined) * 100).toFixed(1),
      best_hypothesis: ranked.sort((a,b) => (b[1].hyp||0) - (a[1].hyp||0))[0][0],
      most_thorough: ranked.sort((a,b) => (b[1].tho||0) - (a[1].tho||0))[0][0],
      token_efficiency_leader: tokEff[0][0],
    },
    by_mode: aggs,
  }
  const FINAL_PATH = join(REPORT_DIR, `experiment-final-all-${ts}.json`)
  writeFileSync(FINAL_PATH, JSON.stringify(finalReport, null, 2) + "\n")
  console.log(`\nFull report: ${FINAL_PATH}`)
}

main().catch(err => { console.error(err); process.exit(1) })
