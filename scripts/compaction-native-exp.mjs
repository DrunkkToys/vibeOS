import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
const HOME = process.env.HOME;
const BENCH_LOG = join(HOME, ".claude", "experiment-benchmark.jsonl");
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) { console.error("DEEPSEEK_API_KEY required"); process.exit(1); }

const TIERS = [
  { tier: "brain", model: "deepseek-v4-pro" },
  { tier: "medium", model: "deepseek-v4-flash" },
  { tier: "cheap", model: "deepseek-chat" },
];
const PRICE = { "deepseek-v4-pro": { p: 1.25, c: 8 }, "deepseek-v4-flash": { p: 0.25, c: 1 }, "deepseek-chat": { p: 0.14, c: 0.56 } };

const TURNS = [
  "Explain how a browser loads a webpage from URL enter to paint.",
  "Deep dive into DNS resolution. What happens at each level?",
  "Explain TCP 3-way handshake in detail.",
  "Now TLS handshake. How does it differ from TCP?",
  "How does HTTP/2 multiplexing improve over HTTP/1.1?",
  "How does the browser parse HTML into the DOM?",
  "Explain CSSOM and the critical rendering path.",
  "Describe layout/reflow. How does the browser position elements?",
  "Explain painting and compositing. What layers are involved?",
  "What happens when JS modifies DOM after paint? Repaint vs reflow.",
];

// Native-style compaction prompt
const COMPACT_PROMPT = `[session compaction] Compress the preceding conversation for continued use.
RULES:
(1) PRESERVE every factual statement, technical detail, explanation, and decision verbatim or as precise bullet points.
(2) DROP verbose connectors, greetings, pleasantries, and redundant restatements.
(3) Keep the logical flow intact so the conversation can continue naturally.
(4) Output ONLY the compressed conversation as a single coherent block — no meta commentary.`;

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

async function runConversation(tier, model, label) {
  const hist = [];
  const results = [];
  process.stdout.write(tier + "/" + label + "... ");

  const compactAt = 6; // after turn 6 (0-indexed), before turn 7

  for (let turn = 0; turn < TURNS.length; turn++) {
    const isPostCompact = turn === compactAt + 1 && label === "NATIVE-COMPACT";

    // Build messages for this turn
    const msgs = [{ role: "system", content: "Answer concisely." }];

    if (isPostCompact) {
      // Native compaction: prepend compressed summary instead of full history
      // The summary goes first, then the current question
      // This mirrors output.context replacement in the compacting hook
      msgs.push({ role: "system", content: "[This session was compacted at this point. The compressed prior conversation follows.]" });
      msgs.push({ role: "user", content: hist[0]?.content || "" }); // compressed summary
      msgs.push({ role: "user", content: TURNS[turn] });
    } else {
      for (const h of hist) msgs.push(h);
      msgs.push({ role: "user", content: TURNS[turn] });
    }

    const r = await callAPI(model, msgs);
    if (!r.ok) {
      results.push({ tier, experiment: label, turn, latency_ms: r.lat, error: r.err });
    } else {
      results.push({
        ts: new Date().toISOString(), event: "compaction-native", tier, experiment: label, turn,
        tokens_in: r.ti, tokens_out: r.to, latency_ms: r.lat, tok_per_sec: r.tps, cost_est: r.cost,
        hist_len: hist.length,
      });
      appendFileSync(BENCH_LOG, JSON.stringify(results[results.length-1]) + "\n");

      if (isPostCompact) {
        // After compaction: add the response, but don't keep growing history
        // Keep only the compressed summary + this response
        hist.splice(0, hist.length); // clear
        hist.push({ role: "assistant", content: hist[0]?.content || "" }); // keep summary
        hist.push({ role: "assistant", content: r.content }); // add new response
      } else if (turn === compactAt && label === "NATIVE-COMPACT") {
        // COMPACTION POINT: after receiving turn 6's answer,
        // ask model to compress all history into a summary
        const compMsgs = [
          { role: "system", content: "You compress conversations, preserving all facts and technical details." },
          ...hist,
          { role: "user", content: COMPACT_PROMPT },
        ];
        const compResult = await callAPI(model, compMsgs);
        if (compResult.ok) {
          results.push({
            ts: new Date().toISOString(), event: "compaction-native", tier, experiment: label, turn: "compress",
            tokens_in: compResult.ti, tokens_out: compResult.to, latency_ms: compResult.lat, cost_est: compResult.cost,
            note: "native-style compaction executed",
          });
          appendFileSync(BENCH_LOG, JSON.stringify(results[results.length-1]) + "\n");
          // Replace history with compacted summary (as assistant context)
          hist.length = 0;
          hist.push({ role: "assistant", content: compResult.content });
        }
        // Add the current response that was just received
        hist.push({ role: "assistant", content: r.content });
      } else {
        // Normal mode: add to history
        hist.push({ role: "assistant", content: r.content });
      }
    }
  }

  // Stats
  const ok = results.filter(r => !r.error && typeof r.turn === "number");
  const f3 = ok.filter(r => r.turn < 3);
  const l2 = ok.filter(r => r.turn >= TURNS.length - 2);
  const avgF3 = f3.length > 0 ? Math.round(f3.reduce((s, r) => s + (r.tokens_out || 0), 0) / f3.length) : 0;
  const avgL2 = l2.length > 0 ? Math.round(l2.reduce((s, r) => s + (r.tokens_out || 0), 0) / l2.length) : 0;
  const deg = avgF3 > 0 ? (((avgL2 - avgF3) / avgF3) * 100).toFixed(1) : "N/A";
  const cost = results.reduce((s, r) => s + (r.cost_est || 0), 0);

  console.log("deg=" + deg + "% cost=$" + cost.toFixed(5));
  return { results, avgF3, avgL2, degradation: deg, totalCost: cost };
}

async function run() {
  console.log("=== NATIVE COMPACTION EXPERIMENT ===");

  const all = [];

  for (const t of TIERS) {
    const r = await runConversation(t.tier, t.model, "NATIVE-COMPACT");
    all.push({ tier: t.tier, ...r });
  }

  // Compare against baseline (mass-mt browser-load)
  const lines = readFileSync(BENCH_LOG, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const baseline = lines.filter(r => r.event === "mass-mt" && r.script === "browser-load" && !r.error);
  const customCompact = lines.filter(r => r.event === "compaction-exp" && !r.error && r.turn !== "compact");

  console.log("\n=== COMPARISON ===");
  console.log("Tier     | Condition       | First3 tok | Last2 tok | Degradation | Cost");
  console.log("---------|-----------------|------------|-----------|-------------|-------");

  for (const t of ["brain", "medium", "cheap"]) {
    // Baseline (no compaction)
    const bt = baseline.filter(r => r.tier === t).sort((a, b) => a.turn - b.turn);
    if (bt.length >= 6) {
      const f3 = bt.filter(r => r.turn < 3);
      const l2 = bt.filter(r => r.turn >= bt.length - 2);
      const aF3 = f3.length > 0 ? Math.round(f3.reduce((s, r) => s + (r.tokens_out || 0), 0) / f3.length) : 0;
      const aL2 = l2.length > 0 ? Math.round(l2.reduce((s, r) => s + (r.tokens_out || 0), 0) / l2.length) : 0;
      const d = aF3 > 0 ? (((aL2 - aF3) / aF3) * 100).toFixed(1) : "?";
      console.log(t.padEnd(7) + " | BASELINE       | " + String(aF3).padEnd(10) + " | " + String(aL2).padEnd(9) + " | " + d.padEnd(10) + " | $" + bt.reduce((s, r) => s + (r.cost_est||0), 0).toFixed(5));
    }

    // Custom summarization (my first experiment)
    const cc = customCompact.filter(r => r.tier === t).sort((a, b) => a.turn - b.turn);
    if (cc.length >= 6) {
      const f3 = cc.filter(r => r.turn < 3);
      const l2 = cc.filter(r => r.turn >= cc.length - 2);
      const aF3 = f3.length > 0 ? Math.round(f3.reduce((s, r) => s + (r.tokens_out || 0), 0) / f3.length) : 0;
      const aL2 = l2.length > 0 ? Math.round(l2.reduce((s, r) => s + (r.tokens_out || 0), 0) / l2.length) : 0;
      const d = aF3 > 0 ? (((aL2 - aF3) / aF3) * 100).toFixed(1) : "?";
      console.log(t.padEnd(7) + " | CUSTOM-COMPACT  | " + String(aF3).padEnd(10) + " | " + String(aL2).padEnd(9) + " | " + d.padEnd(10) + " | $" + cc.reduce((s, r) => s + (r.cost_est||0), 0).toFixed(5));
    }

    // Native-style compaction (this experiment)
    const nc = all.find(r => r.tier === t);
    if (nc) {
      console.log(t.padEnd(7) + " | NATIVE-COMPACT  | " + String(nc.avgF3).padEnd(10) + " | " + String(nc.avgL2).padEnd(9) + " | " + nc.degradation.padEnd(10) + " | $" + nc.totalCost.toFixed(5));
    }
    console.log("---------|-----------------|------------|-----------|-------------|-------");
  }

  // Per-turn detail for native compaction
  console.log("\n=== NATIVE COMPACTION PER-TURN DETAIL ===");
  for (const t of ["brain", "medium", "cheap"]) {
    const nc = all.find(r => r.tier === t);
    if (!nc) continue;
    const turns = nc.results.filter(r => typeof r.turn === "number" && !r.error).sort((a, b) => a.turn - b.turn);
    console.log(t + ":");
    for (const r of turns) {
      console.log("  t" + r.turn + ": tok_out=" + String(r.tokens_out || "?").padStart(4) + " lat=" + r.latency_ms + "ms" + (r.turn === 7 ? " ← POST-COMPACTION" : ""));
    }
  }

  // Save
  const rf = join(HOME, ".claude", "reports", "compaction-native-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
  writeFileSync(rf, JSON.stringify({
    meta: { generated_at: new Date().toISOString(), type: "compaction-native-exp" },
    results: all.map(r => ({ tier: r.tier, degradation: r.degradation, first3: r.avgF3, last2: r.avgL2, cost: r.totalCost })),
  }, null, 2));
  console.log("\nReport: " + rf);
}
run().catch(console.error);
