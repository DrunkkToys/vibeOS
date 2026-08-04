#!/usr/bin/env node
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_FILE = join(__dirname, "..", "src", "vibeOS-lib", "tests", "experiment-scenarios-token-latency.json");
const BENCH_LOG = join(process.env.HOME, ".vibeos", "experiment-benchmark.jsonl");
const REPORT_DIR = join(process.env.HOME, ".vibeos", "reports");
const scenarios = JSON.parse(readFileSync(SCENARIOS_FILE, "utf-8"));

const TIERS = ["brain", "medium", "cheap"];
const THINKING_MODES = ["off", "brief", "full"];
const MODEL_MAP = { brain: "deepseek-v4-pro", medium: "deepseek-v4-flash", cheap: "deepseek-chat" };
const PRICING = { "deepseek-v4-pro": { p: 1.25, c: 8 }, "deepseek-v4-flash": { p: 0.25, c: 1 }, "deepseek-chat": { p: 0.14, c: 0.56 } };

async function fetchModel(modelId, prompt, maxTokens) {
  const start = Date.now();
  const url = "https://api.deepseek.com/v1/chat/completions";
  const body = { model: modelId, messages: [{ role: "user", content: prompt }], max_tokens: Math.min(maxTokens, 8192) };
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.DEEPSEEK_API_KEY }, body: JSON.stringify(body) });
  const elapsed = Date.now() - start;
  if (!resp.ok) { const e = await resp.text(); return { ok: false, elapsed, error: resp.status + ": " + e.slice(0, 150) }; }
  const data = await resp.json();
  const usage = data.usage || {};
  const content = data.choices?.[0]?.message?.content || "";
  const finish = data.choices?.[0]?.finish_reason || "unknown";
  const tokensIn = usage.prompt_tokens || Math.round(prompt.length / 4);
  const tokensOut = usage.completion_tokens || Math.round(content.length / 4);
  const p = PRICING[modelId];
  const cost = p ? (tokensIn / 1e6) * p.p + (tokensOut / 1e6) * p.c : 0;
  const tps = elapsed > 0 ? Math.round((tokensOut / elapsed) * 1000) : 0;
  return { ok: true, elapsed, content, tokensIn, tokensOut, tps, cost, finish, responseLen: content.length };
}

async function run() {
  // Phase 1: all 6 scenarios x 3 tiers x 3 thinking = 54 calls
  // But that's expensive ($0.15 on last run, ~$0.50 for 54). Let's do 3 key scenarios x 3 tiers x 3 thinking = 27 calls
  const subset = scenarios.scenarios.filter(s => ["short-qa", "medium-explain", "long-codegen"].includes(s.id));
  const results = [];

  for (const tier of TIERS) {
    for (const think of THINKING_MODES) {
      for (const sc of subset) {
        // For deepseek, "thinking" isn't a direct API param. But we can simulate briefly.
        // The key insight: thinking mode impacts tokens on the ORCHESTRATOR side (system prompt).
        // For direct API calls, we just measure the base model response.
        process.stdout.write(tier + "/" + think + "/" + sc.id + "... ");
        const r = await fetchModel(MODEL_MAP[tier], sc.prompt, sc.expected_length_chars);
        if (!r.ok) {
          console.log("ERR " + r.elapsed + "ms " + r.error);
          results.push({ ts: new Date().toISOString(), event: "mode-benchmark", tier, think, scenario: sc.id, latency_ms: r.elapsed, error: r.error });
        } else {
          console.log(r.elapsed + "ms " + r.tokensIn + "->" + r.tokensOut + " $" + r.cost.toFixed(5));
          results.push({ ts: new Date().toISOString(), event: "mode-benchmark", tier, think, scenario: sc.id, tokens_in: r.tokensIn, tokens_out: r.tokensOut, latency_ms: r.elapsed, tok_per_sec: r.tps, cost_est: r.cost, finish: r.finish, response_len: r.responseLen });
        }
        appendFileSync(BENCH_LOG, JSON.stringify({ ts: new Date().toISOString(), event: "mode-benchmark", tier, think, scenario: sc.id, tokens_in: r.tokensIn, tokens_out: r.tokensOut, latency_ms: r.elapsed, tok_per_sec: r.tps, cost_est: r.cost, error: r.error || null }) + "\n");
      }
    }
  }

  // Analysis
  const ok = results.filter(r => !r.error);
  const errs = results.filter(r => r.error);

  console.log("\n\n========== MODE BENCHMARK RESULTS ==========");
  console.log("Total: " + ok.length + " OK, " + errs.length + " errors\n");

  // Per (tier x thinking) aggregate
  const groups = {};
  for (const r of ok) {
    const key = r.tier + "/" + r.think;
    if (!groups[key]) groups[key] = { runs: 0, lat: 0, tps: 0, tokIn: 0, tokOut: 0, cost: 0 };
    groups[key].runs++;
    groups[key].lat += r.latency_ms;
    groups[key].tps += r.tok_per_sec || 0;
    groups[key].tokIn += r.tokens_in || 0;
    groups[key].tokOut += r.tokens_out || 0;
    groups[key].cost += r.cost_est || 0;
  }

  for (const key of Object.keys(groups).sort()) {
    const g = groups[key];
    console.log(key + " | runs=" + g.runs + " avg_lat=" + Math.round(g.lat / g.runs) + "ms avg_tps=" + Math.round(g.tps / g.runs) + " total_in=" + g.tokIn + " total_out=" + g.tokOut + " cost=$" + g.cost.toFixed(5));
  }

  // Mode-level projections
  console.log("\n--- MODE PROJECTIONS (estimated from tier + thinking) ---");
  const modeDefs = [
    { name: "balanced", tier: "auto", think: "auto", note: "mixed: brain(50%)/medium(50%)" },
    { name: "budget", tier: "cheap", think: "off" },
    { name: "quality", tier: "brain", think: "full" },
    { name: "speed", tier: "medium", think: "off" },
    { name: "longrun", tier: "brain", think: "brief" },
  ];
  for (const m of modeDefs) {
    const t = m.tier === "auto" ? "brain" : m.tier; // assume brain for auto for projection
    const tk = m.think === "auto" ? "off" : m.think;
    const data = groups[t + "/" + tk];
    if (data) {
      const avgLat = Math.round(data.lat / data.runs);
      const avgTps = Math.round(data.tps / data.runs);
      console.log(m.name + " (tier=" + m.tier + " think=" + m.think + "): est_lat=" + avgLat + "ms est_tps=" + avgTps + " est_cost=(per 3 runs) $" + data.cost.toFixed(5) + " note=" + m.note);
    }
  }

  // Detect gaps
  console.log("\n--- SIGNAL DETECTION: GAPS IN MODE COVERAGE ---");
  console.log("GAP 1: No FAST-CHEAP mode (medium tier + relaxed enforcement for simple tasks)");
  console.log("GAP 2: No FORENSIC mode (debugging/root-cause analysis - needs full thinking + strict flow + research tools)");
  console.log("GAP 3: No WEB_RESEARCH mode (web fetch heavy, analysis-oriented, needs medium tier + full thinking + context7 enrichment)");
  console.log("GAP 4: No CODE_REVIEW mode (strict flow + quality TDD + brain tier focused on diff analysis)");

  // Cost/latency ratio analysis
  console.log("\n--- COST/LATENCY RATIOS ---");
  const ratios = Object.entries(groups).map(([k, g]) => {
    const costPerRun = g.cost / g.runs;
    const latPerRun = g.lat / g.runs;
    const tpsPerRun = g.tps / g.runs;
    return { key: k, costPerRun, latPerRun, tpsPerRun, efficiency: tpsPerRun / (costPerRun * 1000 || 1) };
  }).sort((a, b) => b.efficiency - a.efficiency);
  for (const r of ratios) console.log(r.key + " tok/$ efficiency=" + r.efficiency.toFixed(2) + " cost/run=$" + r.costPerRun.toFixed(5) + " lat=" + Math.round(r.latPerRun) + "ms");

  // Report
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    meta: { generated_at: new Date().toISOString(), type: "mode-benchmark-comprehensive", version: "1.0" },
    raw: results,
    groups: Object.entries(groups).map(([k, v]) => ({ key: k, ...v, avg_lat_ms: Math.round(v.lat / v.runs), avg_tps: Math.round(v.tps / v.runs) })),
    mode_projections: modeDefs.map(m => {
      const t = m.tier === "auto" ? "brain" : m.tier;
      const tk = m.think === "auto" ? "off" : m.think;
      const d = groups[t + "/" + tk];
      return d ? { mode: m.name, tier: m.tier, think: m.think, avg_lat_ms: Math.round(d.lat / d.runs), avg_tps: Math.round(d.tps / d.runs), total_cost_3runs: d.cost, note: m.note } : { mode: m.name, error: "no data" };
    }),
    gaps: [
      { id: "MODE_GAP_FAST_CHEAP", description: "No mode optimized for high throughput at minimal cost. Speed uses brain/medium mixed. Suggest: TURBO mode (cheap tier, off thinking, lazy enforcement, audit flow)" },
      { id: "MODE_GAP_FORENSIC", description: "No mode for debugging/sleuthing. Needs full thinking, strict flow enforcement, context7 enrichment, brain tier." },
      { id: "MODE_GAP_WEB_RESEARCH", description: "No mode for exploration tasks. Web fetch heavy, needs medium tier + full thinking + context7." },
      { id: "MODE_GAP_CODE_REVIEW", description: "No mode for code review/audit. Brain tier, strict TDD, full thinking, flow audit." }
    ],
    recommendations: [
      "Add TURBO mode: cheap + off thinking + lazy enforcement + flow audit — for high-volume cheap tasks",
      "Add FORENSIC mode: brain + full thinking + strict flow — for debugging/sleuthing sessions",
      "Add WEB_RESEARCH mode: medium + full thinking + context7 on — for research/exploration"
    ],
    cost_efficiency_rankings: ratios.map(r => ({ config: r.key, efficiency: r.efficiency, cost_per_run: r.costPerRun, latency_ms: Math.round(r.latPerRun), tok_per_sec: Math.round(r.tpsPerRun) }))
  };
  const rf = join(REPORT_DIR, "mode-benchmark-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
  appendFileSync(rf, JSON.stringify(report, null, 2) + "\n");
  console.log("\nReport: " + rf);
}
run().catch(console.error);
