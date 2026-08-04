#!/usr/bin/env node
// v6: Test 5 new mode hypotheses against static baseline
// REPORTING, DEFENSE_IN_DEPTH, SYNTHESIS, VERIFY, DRILL_DOWN
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HOME = homedir(), __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(__dirname, "..")
const LOG = join(HOME, ".vibeos", "experiment-v6-results.jsonl")
const RPT = join(HOME, ".vibeos", "reports")
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z"
const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("FATAL: DEEPSEEK_API_KEY not set"); process.exit(1) }

const CONCURRENCY = 5

const S = [
  {id:"api-auth",d:"api",p:"Express.js JWT auth middleware: validate token, attach user, 401 handling."},
  {id:"rate-limit",d:"api",p:"Sliding window rate limiter for Express. Limit N req/window/IP, 429, cleanup."},
  {id:"rest-api",d:"arch",p:"Multi-file REST task manager: types, store, middleware, routes, app."},
  {id:"task-runner",d:"systems",p:"Concurrent TaskRunner<T>: semaphore, AbortSignal, run/cancel/status."},
  {id:"fsm",d:"arch",p:"Type-safe FSM generic over S,E: transition, can, callbacks, history."},
  {id:"dijkstra",d:"algorithm",p:"Dijkstra with BinaryHeap. Handle empty, start=end, negative weights."},
  {id:"raft",d:"arch",p:"Explain Raft: leader election, log replication, safety. ~500 words."},
  {id:"lru",d:"systems",p:"LRU cache: O(1) get/put, generics, TTL, eviction events. ~200 lines."},
  {id:"saas-api",d:"api",p:"Multi-tenant SaaS REST API: JWT, RBAC, CRUD, rate-limit, pagination, webhooks."},
  {id:"race",d:"debug",p:"Find ALL race conditions in TS code. Explain execution sequences. Fix."},
  {id:"vuln-audit",d:"security",p:"Audit Express app: SQL injection, XSS, CSRF, prototype pollution, SSRF."},
  {id:"rca",d:"debug",p:"Production incident: 500s peak. ETIMEDOUT/ECONNRESET. Root cause analysis."},
  {id:"tradeoff",d:"arch",p:"Event pipeline 50k/s: Kafka->Flink vs RabbitMQ->Node vs Kinesis->Lambda."},
  {id:"memleak",d:"debug",p:"Node OOM 2GB/24h. 800k instances. Find leaks, GC roots, fix."},
  {id:"code-review",d:"audit",p:"Code review payment module. All bugs/security/anti-patterns. CRITICAL to LOW."},
  {id:"perf-bottle",d:"systems",p:"Pipeline 100k/45s: enrich->validate->transform->insert. Bottlenecks + fixes."},
  {id:"ts-error",d:"debug",p:"Trace TS error: 'string|undefined not assignable to string' through generics."},
  {id:"deadlock",d:"debug",p:"Deadlock analysis: interleaving, why deadlock vs livelock, fix."},
  {id:"data-int",d:"security",p:"Order processing: race conditions, corruption, fixes. Stock+payment+fulfill."},
  {id:"auth-flow",d:"security",p:"Audit auth flow: login, session, admin, password reset. All vulns."},
  {id:"dist-fail",d:"systems",p:"A->B->C->D chain fails: timeout/broken-pipe/refused peak. Diagnose."},
  {id:"postmortem",d:"audit",p:"Deployment caused partial outage. Rollback worse. Timeline + root cause."},
  {id:"refactor-cb",d:"arch",p:"Refactor callbacks to async/await preserving error propagation + edge cases."},
  {id:"state-corrupt",d:"debug",p:"React stale data after navigation. Global store. Trace + root causes."},
  {id:"dep-hell",d:"systems",p:"Monorepo 3 packages react 17/18, router 5/6. Conflict + hoisting strategies."},
  {id:"tcp-udp",d:"general",p:"TCP vs UDP difference? 2-3 sentences."},
  {id:"primes",d:"algorithm",p:"Sum of primes 1-100. Show work."},
  {id:"split-monolith",d:"refactor",p:"Split monolith into models, utils, repositories, services. Preserve behavior."},
  {id:"collab-edit",d:"arch",p:"Real-time collab editor: OT vs CRDT, WebSocket, conflict resolution. ~500 words."},
  {id:"conflicting-api",d:"arch",p:"API: paginated+filter+sort on 10M rows, <200ms, computed fields, REST+GraphQL."},
].map((s,i)=>({...s,o:i}))

const BASE = [
  "[context7] Use context7 for library/framework docs — saves ~$0.06/turn.",
  "[code quality] Write production-grade code with error handling, types, tests.",
].join("\n")

const MODES = {
  static: null,

  reporting: [
    "[mode: formal report] Structure your output as a formal engineering report:",
    "  - Executive summary (key findings in 2-3 sentences)",
    "  - Methodology / approach",
    "  - Detailed findings with evidence",
    "  - Trade-offs documented with rationale",
    "  - Conclusion with confidence level (HIGH/MEDIUM/LOW)",
    "  - Recommendations",
    "Use sections, sub-sections, and evidence citations throughout.",
  ].join("\n"),

  defense_in_depth: [
    "[mode: defense in depth] For every component you design or code:",
    "  1. THREAT MODEL — what is this defending against?",
    "  2. IMPLEMENT — write the code with defense built in",
    "  3. VERIFY — demonstrate the defense handles the threat",
    "Never write code without first specifying the threat model it addresses.",
    "Consider: injection, broken auth, data exposure, logic errors, race conditions, resource exhaustion.",
  ].join("\n"),

  synthesis: [
    "[mode: synthesis] You are synthesizing information across multiple sources or perspectives:",
    "  - Identify patterns across all available data",
    "  - Surface contradictions or unresolved tensions",
    "  - Distill into actionable conclusions",
    "  - Each finding gets a confidence level (HIGH/MEDIUM/LOW)",
    "  - Output: actionable synthesis, not raw analysis.",
  ].join("\n"),

  verify: [
    "[mode: verification-first] Before writing any code, declare the verification criteria:",
    "  - Which edge cases must pass?",
    "  - What invariants must hold?",
    "  - What does success look like?",
    "Then write code that meets each criterion.",
    "After each code block, include a verification section: tested against which cases, how correctness is established.",
  ].join("\n"),

  drill_down: [
    "[mode: root cause analysis] Use the 5-Why method:",
    "  - Start with the symptom",
    "  - Ask 'why' iteratively — each answer becomes the next question",
    "  - At each level: identify the mechanism, not just the proximate cause",
    "  - Stop only when you hit a fundamental constraint or design decision",
    "  - Output: symptom -> level 1 -> level 2 -> level 3 -> level 4 -> level 5 -> root cause -> fixes at each level.",
  ].join("\n"),
}

function sys(m) { const d = MODES[m]; return d ? BASE + "\n\n" + d : BASE }

async function callAPI(sp, up) {
  const start = Date.now()
  try {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method:"POST", headers:{"Content-Type":"application/json",Authorization:"Bearer "+API_KEY},
      body:JSON.stringify({model:"deepseek-chat",messages:[{role:"system",content:sp},{role:"user",content:up}],max_tokens:8192}),
    })
    const elapsed = Date.now()-start
    if(!r.ok) return {ok:false,elapsed,error:r.status}
    const d = await r.json()
    return {ok:true,elapsed,content:d.choices?.[0]?.message?.content||"",tokensIn:d.usage?.prompt_tokens||0,tokensOut:d.usage?.completion_tokens||0}
  } catch(e) { return {ok:false,elapsed:Date.now()-start,error:e.message} }
}

function sc(text) {
  if(!text) return {c:0,comp:0,s:1,combined:0,wc:0}
  const l = text.toLowerCase()
  let c=0.3,comp=0,s=1
  for(const p of [/error|throw|catch|try/i,/return|=>/,/function|class|interface/,/test|describe|it\s*\(/i,/\bPromise\b/,/async.*await/]) if(p.test(text)) c+=0.1
  for(const p of [/function|class|const|let|var/,/export\s+(default\s+)?(function|class|const)/,/:\s*(string|number|boolean|void|any|Promise|Record|Partial|Pick)\b/,/import/,/@param|@returns|JSDoc/,/test|describe|it\s*\(/i]) if(p.test(text)) comp+=0.1
  if(/eval\s*\(/.test(text)) s-=0.3
  if(/process\.exit/.test(text)&&!/test/i.test(text)) s-=0.1
  return {c:Math.min(1,c),comp:Math.min(1,comp),s:Math.max(0,Math.min(1,s)),combined:c+comp+s,wc:text.split(/\s+/).length}
}

function fm(text) {
  if(!text) return {ev:0,hy:0,un:0,so:0,th:0}
  const l=text.toLowerCase()
  return {
    ev: Math.min(1,(l.match(/because|since|therefore|evidence|demonstrat|consequently|leads?\s+to/g)||[]).length/12),
    hy: Math.min(1,(l.match(/alternativ|hypothes[ei]s|possibility|could\s+be|might\s+be|scenario|consider|approach/g)||[]).length/10),
    un: Math.min(1,(l.match(/unknown|uncertain|ambiguous|assumption|trade-?off|limitation|not\s+clear|unclear/g)||[]).length/9),
    so: Math.min(1,(text.match(/^\d+[\.\)]|^#{1,3}\s|^[-*]\s|^[A-Z][a-z]+:/gm)||[]).length/7),
    th: Math.min(1,(l.match(/verify|validat|edge\s+case|error\s+(path|handl|case)|failur|except|null\s+check|fallback|recovery/g)||[]).length/10),
  }
}

function log(e) { appendFileSync(LOG, JSON.stringify({ts:new Date().toISOString(),...e})+"\n") }

async function main() {
  mkdirSync(RPT,{recursive:true})
  const M = Object.keys(MODES), total = S.length * M.length
  console.log(`=== v6: New mode hypotheses ===\nModes: ${M.join(", ")}\nCalls: ${total}\n`)

  const tasks = []
  for(const s of S) for(const m of M) tasks.push({s,m,sp:sys(m),up:s.p+"\n\nBe thorough."})
  for(let i=tasks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tasks[i],tasks[j]]=[tasks[j],tasks[i]]}

  let done=0, results=[]
  async function worker(slice){
    for(const t of slice){
      const r=await callAPI(t.sp,t.up)
      const b={variant:t.m,scenario:t.s.id,domain:t.s.d}
      if(!r.ok){log({event:"v6",...b,ok:false});done++;continue}
      const s=sc(r.content),m=fm(r.content)
      log({event:"v6",...b,ok:true,combined:s.combined,c:s.c,comp:s.comp,sf:s.s,...m,tokIn:r.tokensIn,tokOut:r.tokensOut,lat:r.elapsed})
      results.push({...b,combined:s.combined,c:s.c,comp:s.comp,sf:s.s,...m,tok:r.tokensIn+r.tokensOut,lat:r.elapsed})
      done++
      if(done%10===0||done===total) process.stdout.write(`\r  ${done}/${total} (${(done/total*100).toFixed(0)}%)`)
    }
  }

  const cs=Math.ceil(tasks.length/CONCURRENCY)
  await Promise.all(Array.from({length:CONCURRENCY},(_,i)=>worker(tasks.slice(i*cs,(i+1)*cs))))
  process.stdout.write("\n\n")

  const ok=results.filter(r=>r.combined>0)
  const mean=arr=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0
  const byMode={};for(const r of ok){if(!byMode[r.variant])byMode[r.variant]=[];byMode[r.variant].push(r)}

  // Merge v3+v5+v6
  let all=[...ok]
  try{
    const v3=readFileSync(join(HOME,".vibeos","experiment-v3-results.jsonl"),"utf-8").trim().split("\n").filter(Boolean).map(l=>JSON.parse(l))
    all.push(...v3.filter(r=>r.ok!==false&&r.combined).map(r=>({variant:r.variant,scenario:r.scenario,domain:r.domain,combined:r.combined,ev:r.evidenceDepth||0,hy:r.hypothesisCoverage||0,un:r.uncertaintyDisc||0,th:r.thoroughness||0,tok:(r.tokensIn||0)+(r.tokensOut||0)})))
  }catch{}
  try{
    const v5=readFileSync(join(HOME,".vibeos","experiment-v5-results.jsonl"),"utf-8").trim().split("\n").filter(Boolean).map(l=>JSON.parse(l))
    all.push(...v5.filter(r=>r.ok!==false&&r.combined).map(r=>({variant:r.variant,scenario:r.scenario,domain:r.domain,combined:r.combined,ev:r.ev||0,hy:r.hyp||0,un:r.unc||0,th:r.tho||0,tok:r.tok||0})))
  }catch{}

  const merged={};for(const r of all){if(!merged[r.variant])merged[r.variant]=[];merged[r.variant].push(r)}
  const modes=Object.keys(merged).sort()
  const aggs={};for(const m of modes){const r=merged[m];aggs[m]={n:r.length,combined:mean(r.map(x=>x.combined)),ev:mean(r.map(x=>x.ev||0)),hy:mean(r.map(x=>x.hy||0)),un:mean(r.map(x=>x.un||0)),th:mean(r.map(x=>x.th||0)),tok:mean(r.map(x=>x.tok||0))}}

  const ranked=Object.entries(aggs).sort((a,b)=>b[1].combined-a[1].combined)
  const sBase=aggs["static"]

  console.log("=".repeat(120))
  console.log("FINAL: ALL MODES (v3+v5+v6)")
  console.log("=".repeat(120))
  console.log(`\n${"#".padEnd(3)} ${"MODE".padEnd(20)} ${"n".padEnd(4)} ${"COMBINED".padEnd(10)} ${"EVID".padEnd(6)} ${"HYP".padEnd(6)} ${"UNCERT".padEnd(7)} ${"THOR".padEnd(6)} ${"TOK/PT".padEnd(7)} ${"NOTE".padEnd(30)}`)
  console.log("-".repeat(120))

  for(let i=0;i<ranked.length;i++){
    const [m,a]=ranked[i]
    const d=sBase?((a.combined-sBase.combined)*100/sBase.combined).toFixed(1):"-"
    const te = a.tok/(a.combined||1)
    let note=""
    if(i===0) note="<< BEST MODE"
    else if(parseFloat(d)>5) note="SIGNIFICANT WIN"
    else if(parseFloat(d)<-5) note="BELOW BASELINE"
    else if(Math.abs(parseFloat(d))<=5) note="~STATIC"
    const newModes = ["reporting","defense_in_depth","synthesis","verify","drill_down"]
    if(newModes.includes(m)) note = (note ? note + " ★NEW" : "★NEW")
    console.log(`${(i+1).toString().padEnd(3)} ${m.padEnd(20)} ${a.n.toString().padEnd(4)} ${a.combined.toFixed(4).padEnd(10)} ${(a.ev||0).toFixed(3).padEnd(6)} ${(a.hy||0).toFixed(3).padEnd(6)} ${(a.un||0).toFixed(3).padEnd(7)} ${(a.th||0).toFixed(3).padEnd(6)} ${te.toFixed(0).padEnd(7)} ${note}`)
  }

  // New mode focus
  console.log(`\n=== NEW MODES SPOTLIGHT ===`)
  const newModes=["reporting","defense_in_depth","synthesis","verify","drill_down"]
  for(const m of newModes){
    const a=aggs[m]
    if(!a) continue
    const rank=ranked.findIndex(([x])=>x===m)+1
    const d=sBase?((a.combined-sBase.combined)*100/sBase.combined).toFixed(1):"-"
    console.log(`#${rank} ${m.padEnd(20)} comb=${a.combined.toFixed(4)} (${d}% vs static) hyp=${(a.hy||0).toFixed(3)} unc=${(a.un||0).toFixed(3)} tho=${(a.th||0).toFixed(3)} tok=${(a.tok||0).toFixed(0)}`)
  }

  // Recommend implementation
  console.log(`\n=== RECOMMENDATION ===`)
  const bestNew = newModes.filter(m=>aggs[m]&&aggs[m].combined>=sBase.combined)
  const borderline = newModes.filter(m=>aggs[m]&&aggs[m].combined>=sBase.combined*0.95)
  console.log(`Modes above static baseline: ${bestNew.length>0?bestNew.join(", "):"NONE"}`)
  console.log(`Modes within 5% of static: ${borderline.length>0?borderline.join(", "):"NONE"}`)
  console.log(`Implement: ${bestNew.concat(borderline).filter((v,i,a)=>a.indexOf(v)===i).join(", ") || "none (need more data)"}`)

  const rp = join(RPT,`experiment-v6-results-${ts}.json`)
  const report = {meta:{experiment:"v6: new modes",modes_tested:newModes,total_data_points:all.length},ranking:ranked.map(([m,a],i)=>({rank:i+1,mode:m,...a})),new_modes:{},recommendation:bestNew.concat(borderline).filter((v,i,a)=>a.indexOf(v)===i)}
  for(const m of newModes){const a=aggs[m];if(a)report.new_modes[m]=a}
  writeFileSync(rp,JSON.stringify(report,null,2)+"\n")
  console.log(`\nReport: ${rp}`)
}
main().catch(e=>{console.error(e);process.exit(1)})
