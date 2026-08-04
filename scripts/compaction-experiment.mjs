import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";
const HOME = process.env.HOME;
const BENCH_LOG = join(HOME, ".vibeos", "experiment-benchmark.jsonl");
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) { console.error("DEEPSEEK_API_KEY required"); process.exit(1); }

const TIERS = [
  { tier: "brain", model: "deepseek-v4-pro" },
  { tier: "medium", model: "deepseek-v4-flash" },
  { tier: "cheap", model: "deepseek-chat" },
];
const PRICE = { "deepseek-v4-pro": { p: 1.25, c: 8 }, "deepseek-v4-flash": { p: 0.25, c: 1 }, "deepseek-chat": { p: 0.14, c: 0.56 } };

const TURNS = [
  "Explain how a browser loads a webpage from URL enter to paint. Be concise.",
  "Deep dive into DNS resolution. What happens at each level?",
  "Explain TCP 3-way handshake in detail.",
  "Now TLS handshake. How does it differ from TCP?",
  "How does HTTP/2 multiplexing improve over HTTP/1.1?",
  "How does the browser parse HTML into the DOM?",
  "Explain CSSOM and the critical rendering path.",
  "Describe layout/reflow. How does the browser position elements?",
  "Explain painting and compositing. What layers are involved?",
  "What happens when JS modifies the DOM after initial paint? Repaint vs reflow.",
];

const COMPACT_TURN = 6; // compact before turn 7 (0-indexed: turn 6 = 7th question)

async function callAPI(model, messages) {
  const start = Date.now();
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });
  const lat = Date.now() - start;
  if (!resp.ok) return { ok: false, lat, err: resp.status + " " + (await resp.text()).slice(0, 60) };
  const d = await resp.json();
  const u = d.usage || {};
  const c = d.choices?.[0]?.message?.content || "";
  const ti = u.prompt_tokens || Math.round(JSON.stringify(messages).length / 4);
  const to = u.completion_tokens || Math.round(c.length / 4);
  const p = PRICE[model];
  const cost = p ? (ti / 1e6) * p.p + (to / 1e6) * p.c : 0;
  return { ok: true, lat, ti, to, tps: lat > 0 ? Math.round((to / lat) * 1000) : 0, cost, content: c };
}

async function runConversation(tier, model, compactAtTurn) {
  const label = compactAtTurn ? "COMPACTED" : "CONTROL";
  const hist = [];
  const results = [];

  process.stdout.write(tier + "/" + label + "... ");

  for (let turn = 0; turn < TURNS.length; turn++) {
    // === COMPACTION at turn 7 (index 6) ===
    if (compactAtTurn !== undefined && turn === compactAtTurn + 1) {
      // Ask model to summarize past N turns into 2-3 sentences
      const summaryPrompt = {
        role: "user",
        content: "Summarize this entire conversation so far in 2-3 sentences. Keep it concise."
      };
      const msgs = [
        { role: "system", content: "You summarize concisely." },
        ...hist.slice(0, -1), // all except the last user message
        summaryPrompt,
      ];
      const r = await callAPI(model, msgs);
      if (!r.ok) {
        process.stdout.write("COMPACTION_ERR(t" + turn + ") ");
        results.push({ tier, event: "compaction-exp", label, turn, latency_ms: r.lat, error: r.err });
        continue;
      }
      const summary = r.content.slice(0, 500);
      // Record compaction as its own datapoint
      results.push({
        ts: new Date().toISOString(),
        event: "compaction-exp", tier, label, turn: "compact",
        tokens_in: r.ti, tokens_out: r.to, latency_ms: r.lat, cost_est: r.cost,
        note: "compaction executed",
      });
      appendFileSync(BENCH_LOG, JSON.stringify(results[results.length-1]) + "\n");

      // Replace history with just the summary
      hist.length = 0;
      hist.push({ role: "assistant", content: summary });
      process.stdout.write("[COMPACT@" + turn + "] ");
    }

    // Normal turn
    const msgs = [{ role: "system", content: "Answer concisely." }];
    for (const h of hist) msgs.push(h);
    msgs.push({ role: "user", content: TURNS[turn] });

    const r = await callAPI(model, msgs);
    if (!r.ok) {
      process.stdout.write("ERR(t" + turn + ") ");
      results.push({ tier, event: "compaction-exp", label, turn, latency_ms: r.lat, error: r.err });
    } else {
      results.push({
        ts: new Date().toISOString(),
        event: "compaction-exp", tier, label, turn,
        tokens_in: r.ti, tokens_out: r.to, latency_ms: r.lat, tok_per_sec: r.tps, cost_est: r.cost,
        hist_len: hist.length,
      });
      appendFileSync(BENCH_LOG, JSON.stringify(results[results.length-1]) + "\n");
      hist.push({ role: "assistant", content: r.content });
    }
  }

  // Summary stats for this run
  const ok = results.filter(r => !r.error);
  const first3Avg = ok.filter(r => typeof r.turn === "number" && r.turn < 3).reduce((s, r) => s + (r.tokens_out || 0), 0) / 3;
  const last2Avg = ok.filter(r => typeof r.turn === "number" && r.turn >= TURNS.length - 2).reduce((s, r) => s + (r.tokens_out || 0), 0) / Math.max(1, ok.filter(r => typeof r.turn === "number" && r.turn >= TURNS.length - 2).length);
  const degradation = first3Avg > 0 ? ((last2Avg - first3Avg) / first3Avg * 100).toFixed(1) : "N/A";
  const totalCost = ok.reduce((s, r) => s + (r.cost_est || 0), 0);

  process.stdout.write("degrad=" + degradation + "% cost=$" + totalCost.toFixed(5) + "\n");
  return { results, first3Avg, last2Avg, degradation, totalCost };
}

async function run() {
  console.log("=== COMPACTION EXPERIMENT ===");
  console.log("Testing: " + TURNS.length + "-turn conversation across 3 tiers");
  console.log("Compaction at turn 7 (index " + COMPACT_TURN + ") for treatment group\n");
  console.log("Hypothesis: Compaction prevents the 55% quality drop seen at turns 9-11\n");

  const allResults = [];

  for (const t of TIERS) {
    // Treatment: WITH compaction at turn 7
    const compacted = await runConversation(t.tier, t.model, COMPACT_TURN);
    allResults.push({ tier: t.tier, label: "COMPACTED", ...compacted });
  }

  // Compare with existing baseline (from mass-mt browser-load data)
  console.log("\n=== COMPARISON WITH BASELINE (non-compacted) ===");
  console.log("Tier     | Condition  | First3 tok | Last2 tok | Degradation | Cost");
  console.log("---------|------------|------------|-----------|-------------|-------");

  // Read baseline from existing log
  const lines = require("fs").readFileSync(BENCH_LOG, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const baseline = lines.filter(r => r.event === "mass-mt" && r.script === "browser-load" && !r.error);

  for (const t of ["brain", "medium", "cheap"]) {
    const bt = baseline.filter(r => r.tier === t);
    if (bt.length >= 6) {
      const first3 = bt.filter(r => r.turn < 3);
      const last2 = bt.filter(r => r.turn >= bt.length - 2);
      const f3 = first3.length > 0 ? Math.round(first3.reduce((s, r) => s + (r.tokens_out || 0), 0) / first3.length) : 0;
      const l2 = last2.length > 0 ? Math.round(last2.reduce((s, r) => s + (r.tokens_out || 0), 0) / last2.length) : 0;
      const deg = f3 > 0 ? (((l2 - f3) / f3) * 100).toFixed(1) : "N/A";
      const cost = bt.reduce((s, r) => s + (r.cost_est || 0), 0);
      console.log(t.padEnd(7) + " | BASELINE   | " + String(f3).padEnd(10) + " | " + String(l2).padEnd(9) + " | " + deg + "%    | $" + cost.toFixed(5));
    }

    const ct = allResults.find(r => r.tier === t && r.label === "COMPACTED");
    if (ct) {
      const f3 = Math.round(ct.first3Avg);
      const l2 = Math.round(ct.last2Avg);
      console.log(t.padEnd(7) + " | COMPACTED  | " + String(f3).padEnd(10) + " | " + String(l2).padEnd(9) + " | " + ct.degradation + "%    | $" + ct.totalCost.toFixed(5));
    }
    console.log("---------|------------|------------|-----------|-------------|-------");
  }

  // Final verdict
  console.log("\n=== VERDICT ===");
  for (const r of allResults) {
    const bDeg = baseline.filter(b => b.tier === r.tier);
    const bDegPct = bDeg.length >= 6 ? (() => {
      const f3 = bDeg.filter(x => x.turn < 3);
      const l2 = bDeg.filter(x => x.turn >= bDeg.length - 2);
      const avgF3 = f3.length > 0 ? f3.reduce((s, x) => s + (x.tokens_out || 0), 0) / f3.length : 0;
      const avgL2 = l2.length > 0 ? l2.reduce((s, x) => s + (x.tokens_out || 0), 0) / l2.length : 0;
      return avgF3 > 0 ? (((avgL2 - avgF3) / avgF3) * 100).toFixed(1) : "?";
    })() : "?";

    console.log(r.tier + ": baseline deg=" + bDegPct + "% vs compacted deg=" + r.degradation + "%");
    if (parseFloat(r.degradation) > parseFloat(bDegPct)) {
      console.log("  → COMPACTION WORSE than baseline (quality degraded more)");
    } else if (parseFloat(r.degradation) < parseFloat(bDegPct)) {
      console.log("  → COMPACTION BETTER than baseline (quality preserved)");
    } else {
      console.log("  → COMPACTION SAME as baseline (no effect)");
    }
  }

  // Save full report
  const rf = join(HOME, ".vibeos", "reports", "compaction-exp-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
  const report = {
    meta: { generated_at: new Date().toISOString(), type: "compaction-experiment", turns: TURNS.length, compact_at_turn: COMPACT_TURN },
    hypothesis: "Compaction at turn 7 prevents the 55% quality drop at turns 9-11",
    compacted: allResults.map(r => ({ tier: r.tier, first3_avg_tok: Math.round(r.first3Avg), last2_avg_tok: Math.round(r.last2Avg), degradation_pct: r.degradation, total_cost: r.totalCost })),
    baseline_tiers: ["brain", "medium", "cheap"].map(t => {
      const bt = baseline.filter(r => r.tier === t);
      if (bt.length < 6) return { tier: t, error: "insufficient baseline" };
      const f3 = bt.filter(x => x.turn < 3);
      const l2 = bt.filter(x => x.turn >= TURNS.length - 2);
      return {
        tier: t,
        first3_avg_tok: Math.round(f3.reduce((s, x) => s + (x.tokens_out || 0), 0) / f3.length),
        last2_avg_tok: Math.round(l2.reduce((s, x) => s + (x.tokens_out || 0), 0) / l2.length),
        degradation_pct: (() => { const a = f3.reduce((s, x) => s + (x.tokens_out || 0), 0) / f3.length; const b = l2.reduce((s, x) => s + (x.tokens_out || 0), 0) / l2.length; return a > 0 ? (((b - a) / a) * 100).toFixed(1) : "?"; })(),
        total_cost: bt.reduce((s, x) => s + (x.cost_est || 0), 0),
      };
    }),
  };
  writeFileSync(rf, JSON.stringify(report, null, 2));
  console.log("\nReport: " + rf);
}
run().catch(console.error);
