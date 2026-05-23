#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
const HOME = process.env.HOME;
const BENCH_LOG = join(HOME, ".claude", "experiment-benchmark.jsonl");
const REPORT_DIR = join(HOME, ".claude", "reports");
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) { console.error("DEEPSEEK_API_KEY required"); process.exit(1); }
const TIERS = [
  { tier: "brain", model: "deepseek-v4-pro" },
  { tier: "medium", model: "deepseek-v4-flash" },
  { tier: "cheap", model: "deepseek-chat" },
];
const PRICE = { "deepseek-v4-pro": { p: 1.25, c: 8 }, "deepseek-v4-flash": { p: 0.25, c: 1 }, "deepseek-chat": { p: 0.14, c: 0.56 } };
const SINGLE = [
  "Process vs thread?",
  "Explain garbage collection in Java/Go.",
  "What is ACID in databases?",
  "Load balancer algorithms?",
  "Consistent hashing uses?",
  "REST vs gRPC differences?",
  "How does a CDN work?",
  "Reverse proxy vs forward proxy?",
  "Optimistic concurrency control?",
  "Stateful vs stateless services?",
  "Message queue use cases?",
  "Horizontal vs vertical scaling?",
  "CAP theorem trade-offs?",
  "Circuit breaker pattern?",
  "Database B-tree indexing?",
  "Distributed tracing (Jaeger)?",
  "Monolithic vs microkernel OS?",
  "Distributed locks and Redlock?",
  "How does etcd work?",
  "What does a kernel scheduler do?",
];

async function callAPI(model, msgs) {
  const start = Date.now();
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify({ model, messages: msgs, max_tokens: 2048 }),
  });
  const lat = Date.now() - start;
  if (!resp.ok) return { ok: false, lat, err: resp.status + " " + (await resp.text()).slice(0, 60) };
  const d = await resp.json();
  const u = d.usage || {};
  const c = d.choices?.[0]?.message?.content || "";
  const ti = u.prompt_tokens || Math.round(JSON.stringify(msgs).length / 4);
  const to = u.completion_tokens || Math.round(c.length / 4);
  const p = PRICE[model]; const cost = p ? (ti / 1e6) * p.p + (to / 1e6) * p.c : 0;
  return { ok: true, lat, ti, to, tps: lat > 0 ? Math.round((to / lat) * 1000) : 0, cost };
}

async function run() {
  mkdirSync(REPORT_DIR, { recursive: true });
  let ok = 0, err = 0, cost = 0;

  // MULTI-TURN: 1 script x 12 turns x 3 tiers = 36 data points (small, validated)
  const mtScript = [
    "Explain how a browser loads a webpage from URL to paint.",
    "Deep dive into DNS. What happens at each level?",
    "Explain TCP 3-way handshake in detail.",
    "Now TLS handshake. How does it differ from TCP?",
    "How does HTTP/2 multiplexing improve over HTTP/1.1?",
    "How does the browser parse HTML into the DOM?",
    "Explain CSSOM and the critical rendering path.",
    "Describe layout/reflow. How does the browser position elements?",
    "Explain painting and compositing. What layers are involved?",
    "What happens when JS modifies DOM after paint? Repaint vs reflow.",
    "How do frameworks like React optimize via virtual DOM?",
    "Summarize the entire critical rendering path from URL to pixels.",
  ];
  console.log("=== MULTI-TURN (36 pts) ===");
  for (const t of TIERS) {
    const hist = []; let tc = 0;
    for (let n = 0; n < mtScript.length; n++) {
      const msgs = [{ role: "system", content: "Answer concisely." }];
      for (const h of hist) msgs.push(h);
      msgs.push({ role: "user", content: mtScript[n] });
      const r = await callAPI(t.model, msgs);
      if (r.ok) { ok++; cost += r.cost; tc += r.cost; appendFileSync(BENCH_LOG, JSON.stringify({ ts: new Date().toISOString(), event: "mass-mt", tier: t.tier, turn: n, tokens_in: r.ti, tokens_out: r.to, latency_ms: r.lat, tok_per_sec: r.tps, cost_est: r.cost, hist_len: hist.length }) + "\n"); hist.push({ role: "assistant", content: r.content }); }
      else { err++; appendFileSync(BENCH_LOG, JSON.stringify({ event: "mass-mt", tier: t.tier, turn: n, error: r.err }) + "\n"); }
    }
    console.log("  " + t.tier + ": 12 turns, $" + tc.toFixed(5));
  }

  // SINGLE-TURN: 20 prompts x 3 tiers x 17 rounds = 1020 data points
  console.log("\n=== SINGLE-TURN (1020 pts) ===");
  const C = 10, R = 17;
  const tasks = [];
  for (let r = 0; r < R; r++) for (const p of SINGLE) for (const t of TIERS) tasks.push({ tier: t.tier, model: t.model, prompt: p });
  for (let i = tasks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tasks[i], tasks[j]] = [tasks[j], tasks[i]]; }
  const wall = Date.now();
  for (let i = 0; i < tasks.length; i += C) {
    const batch = tasks.slice(i, i + C);
    const res = await Promise.allSettled(batch.map(t => callAPI(t.model, [{ role: "system", content: "Answer concisely." }, { role: "user", content: t.prompt }])));
    for (let j = 0; j < res.length; j++) {
      const t = batch[j];
      if (res[j].status !== "fulfilled") { err++; continue; }
      const r = res[j].value;
      if (!r.ok) { err++; appendFileSync(BENCH_LOG, JSON.stringify({ event: "mass-st", tier: t.tier, error: r.err }) + "\n"); }
      else { ok++; cost += r.cost; appendFileSync(BENCH_LOG, JSON.stringify({ ts: new Date().toISOString(), event: "mass-st", tier: t.tier, model: t.model, tokens_in: r.ti, tokens_out: r.to, latency_ms: r.lat, tok_per_sec: r.tps, cost_est: r.cost }) + "\n"); }
    }
    if ((i / C) % 4 === 0) process.stdout.write("\r  " + Math.round(i / tasks.length * 100) + "% " + ok + "ok " + err + "err $" + cost.toFixed(4) + " " + Math.round((Date.now() - wall) / 1000) + "s");
  }
  const secs = Math.round((Date.now() - wall) / 1000);
  console.log("\r  100% " + ok + "ok " + err + "err $" + cost.toFixed(4) + " " + secs + "s");

  // === QUICK ANALYSIS ===
  const entries = readFileSync(BENCH_LOG, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const latest = entries.filter(e => (e.event === "mass-mt" || e.event === "mass-st") && !e.error);
  const agg = {};
  for (const r of latest) {
    if (!agg[r.tier]) agg[r.tier] = { n: 0, lat: 0, tps: 0, tokOut: 0, cost: 0 };
    agg[r.tier].n++; agg[r.tier].lat += r.latency_ms; agg[r.tier].tps += r.tok_per_sec || 0; agg[r.tier].tokOut += r.tokens_out || 0; agg[r.tier].cost += r.cost_est || 0;
  }
  console.log("\n=== FINAL RESULTS ===");
  console.log("New datapoints: " + (ok + err) + " (" + ok + " OK, " + err + " errors)");
  console.log("Total cost: $" + cost.toFixed(5));
  for (const [t, d] of Object.entries(agg).sort()) console.log("  " + t + ": n=" + d.n + " lat=" + Math.round(d.lat / d.n) + "ms tps=" + Math.round(d.tps / d.n) + " tok=" + d.tokOut + " cost=$" + d.cost.toFixed(5));
  // Multi-turn context growth
  const mt = latest.filter(r => r.event === "mass-mt").sort((a, b) => (a.tier + "-" + a.turn).localeCompare(b.tier + "-" + b.turn));
  if (mt.length) {
    console.log("\n--- Multi-turn context growth (first vs last turn) ---");
    for (const t of ["brain", "medium", "cheap"]) {
      const t2 = mt.filter(r => r.tier === t);
      if (t2.length >= 2) console.log("  " + t + ": first=" + t2[0].latency_ms + "ms/tok_in=" + t2[0].tokens_in + " last=" + t2[t2.length - 1].latency_ms + "ms/tok_in=" + t2[t2.length - 1].tokens_in + " (context grew " + t2[0].hist_len + "->" + t2[t2.length - 1].hist_len + " msgs)");
    }
  }
  const rf = join(REPORT_DIR, "mass-benchmark-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
  writeFileSync(rf, JSON.stringify({ meta: { generated_at: new Date().toISOString(), type: "mass-benchmark-v2" }, ok, errors: err, total_cost: cost, aggregate: Object.entries(agg).map(([t, d]) => ({ tier: t, ...d, avg_lat: Math.round(d.lat / d.n), avg_tps: Math.round(d.tps / d.n) })) }, null, 2));
  console.log("\nReport: " + rf);
}
run().catch(console.error);
