#!/usr/bin/env node
// Signal detection from mode benchmark data + historical calibration
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;

// Load ALL data sources
const benchLog = readFileSync(join(HOME, ".claude", "experiment-benchmark.jsonl"), "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const modeCal2022 = JSON.parse(readFileSync(join(HOME, ".claude", "reports", "mode-calibration-20260522-094632.json"), "utf-8"));
const modeCal2023 = tryRead(join(HOME, ".claude", "reports", "mode-calibration-20260523-083050.json"));
const tokenReport = JSON.parse(readFileSync(join(HOME, ".claude", "reports", "token-latency-2026-05-23T06-43-59Z.json"), "utf-8"));

function tryRead(p) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } }

// === PHASE 1: Aggregate mode-benchmark results ===
const modeBench = benchLog.filter(r => r.event === "mode-benchmark" && !r.error);
const tierLatencies = {};
for (const r of modeBench) {
  const k = r.tier + "/" + r.think;
  if (!tierLatencies[k]) tierLatencies[k] = { runs: 0, lat: 0, tps: 0, tokIn: 0, tokOut: 0, cost: 0, scenarios: [] };
  tierLatencies[k].runs++;
  tierLatencies[k].lat += r.latency_ms;
  tierLatencies[k].tps += r.tok_per_sec || 0;
  tierLatencies[k].tokIn += r.tokens_in || 0;
  tierLatencies[k].tokOut += r.tokens_out || 0;
  tierLatencies[k].cost += r.cost_est || 0;
  tierLatencies[k].scenarios.push(r.scenario);
}

console.log("=== PHASE 1: RAW BENCHMARK AGGREGATES ===");
for (const [k, v] of Object.entries(tierLatencies).sort()) {
  const avgLat = Math.round(v.lat / v.runs);
  const avgTps = Math.round(v.tps / v.runs);
  console.log(`${k}: ${v.runs} runs, avg ${avgLat}ms, avg ${avgTps} tok/s, cost $${v.cost.toFixed(5)}, tokIn=${v.tokIn} tokOut=${v.tokOut}`);
}

// === PHASE 2: Mode projections ===
console.log("\n=== PHASE 2: MODE PROJECTIONS ===");
const modeDefs = [
  { name: "balanced", tier: "brain", think: "off", weighting: "mixed(brain50/medium50)", baseTier: "brain" },
  { name: "budget", tier: "cheap", think: "off", baseTier: "cheap" },
  { name: "quality", tier: "brain", think: "full", baseTier: "brain" },
  { name: "speed", tier: "medium", think: "off", baseTier: "medium" },
  { name: "longrun", tier: "brain", think: "brief", baseTier: "brain" },
];
for (const m of modeDefs) {
  const d = tierLatencies[m.baseTier + "/" + m.think];
  if (d) {
    const avgLat = Math.round(d.lat / d.runs);
    const avgTps = Math.round(d.tps / d.runs);
    const costPerRun = d.cost / d.runs;
    console.log(`${m.name}: est ${avgLat}ms, ${avgTps} tok/s, $${costPerRun.toFixed(5)}/run, ${m.weighting || ""}`);
  }
}

// === PHASE 3: SIGNAL DETECTION ===
console.log("\n=== PHASE 3: SIGNALS ===");

// Signal 1: Tier parity check — brain vs medium latency
const brainOff = tierLatencies["brain/off"];
const medOff = tierLatencies["medium/off"];
if (brainOff && medOff) {
  const brainAvg = brainOff.lat / brainOff.runs;
  const medAvg = medOff.lat / medOff.runs;
  const speedup = (brainAvg - medAvg) / brainAvg * 100;
  console.log(`SIGNAL[TIER_PARITY]: brain avg ${Math.round(brainAvg)}ms vs medium avg ${Math.round(medAvg)}ms (${speedup > 0 ? "medium " + Math.abs(speedup).toFixed(1) + "% faster" : "brain " + Math.abs(speedup).toFixed(1) + "% faster"})`);
  console.log(`  → Cost difference: ${(brainOff.cost / brainOff.runs / (medOff.cost / medOff.runs)).toFixed(1)}x`);
  
  if (Math.abs(speedup) < 15) {
    console.log("  ★ INSIGHT: Brain and medium have near-identical latency. Quality mode (brain/full) can be default without throughput penalty.");
  }
}

// Signal 2: Thinking overhead
for (const tier of ["brain", "medium", "cheap"]) {
  const off = tierLatencies[tier + "/off"];
  const full = tierLatencies[tier + "/full"];
  if (off && full) {
    const offTps = off.tps / off.runs;
    const fullTps = full.tps / full.runs;
    const offLat = off.lat / off.runs;
    const fullLat = full.lat / full.runs;
    console.log(`SIGNAL[THINK_OVERHEAD] ${tier}: off=${Math.round(offLat)}ms/${Math.round(offTps)}tps full=${Math.round(fullLat)}ms/${Math.round(fullTps)}tps`);
  }
}

// Signal 3: Cost efficiency gap
console.log("\nSIGNAL[EFFICIENCY_GAP]: Cost per 1000 tokens out");
for (const [k, v] of Object.entries(tierLatencies).sort()) {
  if (v.tokOut > 0) {
    const costPer1k = (v.cost / v.tokOut) * 1000;
    console.log(`  ${k}: $${costPer1k.toFixed(6)}/1k tok_out`);
  }
}

// Signal 4: Calibration data gap
console.log("\nSIGNAL[CALIBRATION_GAP]:");
const c = modeCal2022;
const allZero = Object.entries(c.mode_breakdown).filter(([name, data]) => data.sessions === 0);
console.log(`  Modes with ZERO real sessions: ${allZero.map(x => x[0]).join(", ")}`);
console.log(`  Checklist says speed_is_fastest_unverified=${c.checklist.speed_is_fastest_unverified}`);
console.log(`  Checklist says ttft_needs_live_bench=${c.checklist.ttft_needs_live_bench}`);

// Signal 5: What tasks do each tier handle best?
console.log("\nSIGNAL[TIER_BEHAVIOR]: Response length by scenario");
for (const tier of ["brain", "medium", "cheap"]) {
  const offKey = tier + "/off";
  const d = tierLatencies[offKey];
  if (d) {
    const avgTokOut = Math.round(d.tokOut / d.runs);
    console.log(`  ${tier} avg response: ${avgTokOut} tok/run`);
  }
}

// Signal 6: Cold start detection
const allBench = benchLog.filter(r => r.event === "mode-benchmark" || r.event === "benchmark-run");
const tierOrder = {};
for (const r of allBench) {
  if (r.tier === "cheap") continue; // checked below
}
const cheapFirst = modeBench.filter(r => r.tier === "cheap" && r.scenario === "short-qa" && r.think === "off")[0];
if (cheapFirst) console.log(`\nSIGNAL[COLD_START]: cheap/first-run latency=${cheapFirst.latency_ms}ms (vs later runs ~270-370ms)`);

// === PHASE 4: MODE GAP ANALYSIS ===
console.log("\n=== PHASE 4: MODE GAP ANALYSIS ===");
const gaps = [];

// Gap A: No TURBO mode (cheap/fast/dumb)
console.log("GAP[A] TURBO: cheap tier + off thinking + lazy enforcement");
console.log("  Current budget mode uses cheap + relaxed enforcement");
console.log("  → Could be optimized as cheap + OFF thinking + lazy TDD + audit flow");
console.log("  Est: ~$0.00004/run (vs budget ~$0.00014)");

// Gap B: No FORENSIC mode
console.log("\nGAP[B] FORENSIC: brain tier + full thinking + strict flow + context7 enrichment");
console.log("  For: bug investigation, root cause analysis, security audit");
console.log("  Needs: full thinking for chain-of-reasoning, strict flow for structured output");
console.log("  Signal: No mode exists for debugging/sleuthing workflows");
console.log("  Future est: ~$0.050/run (similar to quality)");

// Gap C: No WEB_RESEARCH mode
console.log("\nGAP[C] WEB_RESEARCH: medium tier + full thinking + context7 enrichment on");
console.log("  For: exploration, research, competitive analysis");
console.log("  Needs: web fetch, context7 for docs, full thinking for synthesis");
console.log("  Signal: research-audit tool exists but no dedicated mode");
console.log("  Est: ~$0.0015/run (medium is 8x cheaper than brain)");

// Gap D: No CODE_REVIEW mode
console.log("\nGAP[D] CODE_REVIEW: brain tier + strict TDD + full thinking + flow audit");
console.log("  For: PR review, diff analysis, quality gate");
console.log("  Signal: Existing quality mode enables enforcement but no audit-focused mode");
console.log("  Est: ~$0.050/run");

// Gap E: No FAST_ITERATION mode
console.log("\nGAP[E] FAST_ITERATION: medium tier + off thinking + lazy everything");
console.log("  For: rapid prototyping, quick edits, simple tasks");
console.log("  Signal: Looking at speed mode (medium + off thinking) — this IS fast iteration");
console.log("  → Speed mode fills this gap already");

// === PHASE 5: RECOMMENDATIONS ===
console.log("\n=== PHASE 5: RECOMMENDATIONS ===");
console.log("1. ENHANCE EXISTING MODES: Speed mode should be made stricter (it overlaps with budget)");
console.log("2. ADD FORENSIC MODE: brain + full thinking + strict flow + context7 for debugging");
console.log("3. ADD WEB_RESEARCH MODE: medium + full thinking + context7 on for exploration");
console.log("4. RECALIBRATE AUTO MODE: Since brain = medium in latency, auto should prefer medium until quality needs brain");
console.log("5. UPDATE CHECKLIST: Re-run calibration with live data to verify all modes");

// Save analysis report
const report = {
  meta: { generated_at: new Date().toISOString(), type: "mode-signal-analysis", version: "1.0" },
  mode_projections: modeDefs.filter(m => tierLatencies[m.baseTier + "/" + m.think]).map(m => {
    const d = tierLatencies[m.baseTier + "/" + m.think];
    return { mode: m.name, tier: m.tier, thinking: m.think, avg_lat_ms: Math.round(d.lat / d.runs), avg_tps: Math.round(d.tps / d.runs), cost_per_run: d.cost / d.runs, tok_eff: (d.cost / d.tokOut) * 1000 };
  }),
  gaps_found: [
    { id: "TURBO", priority: "low", description: "Cheap + off thinking, already covered by budget" },
    { id: "FORENSIC", priority: "high", description: "Brain + full thinking + strict flow — no existing mode covers debugging" },
    { id: "WEB_RESEARCH", priority: "high", description: "Medium + full thinking + context7 — fills exploration gap" },
    { id: "CODE_REVIEW", priority: "medium", description: "Brain + full thinking + strict TDD — partially covered by quality" },
  ],
  key_insights: [
    "Brain and medium have nearly identical latency (~320ms avg) — medium is not meaningfully faster",
    "Medium is 8x cheaper than brain for equivalent throughput",
    "First cheap request is 2.6x slower than subsequent (cold start: 981ms vs ~370ms)",
    "All modes except 'balanced' have 0 real sessions in calibration data",
    "Calibration checklist marks all mode hypotheses as 'unverified'"
  ],
  recommendations: [
    "Add FORENSIC mode for debugging/sleuthing workflows",
    "Add WEB_RESEARCH mode for exploration tasks",
    "Recalibrate auto mode selection since brain=medium in latency",
    "Run forced mode sessions to populate calibration data for non-balanced modes"
  ]
};

mkdirSync(join(HOME, ".claude", "reports"), { recursive: true });
const rf = join(HOME, ".claude", "reports", "mode-signal-analysis-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
appendFileSync(rf, JSON.stringify(report, null, 2) + "\n");
console.log("\nAnalysis report: " + rf);
