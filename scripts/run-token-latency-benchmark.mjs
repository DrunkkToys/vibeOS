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
const MODEL_IDS = {
  brain: "deepseek-v4-pro",
  medium: "deepseek-v4-flash",
  cheap: "deepseek-chat",
};
const PRICING_MAP = {
  "deepseek-v4-pro": { prom: 1.25, comp: 8 },
  "deepseek-v4-flash": { prom: 0.25, comp: 1 },
  "deepseek-chat": { prom: 0.14, comp: 0.56 },
};
function estimateTokens(chars) { return Math.round(chars / 4); }
async function fetchModel(modelId, prompt, maxTokens) {
  const url = "https://api.deepseek.com/v1/chat/completions";
  const body = { model: modelId, messages: [{ role: "user", content: prompt }], max_tokens: Math.min(maxTokens, 8192) };
  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - start;
  if (!response.ok) {
    const err = await response.text();
    return { ok: false, elapsed, error: response.status + ": " + err.slice(0, 200) };
  }
  const data = await response.json();
  const usage = data.usage || {};
  const content = data.choices?.[0]?.message?.content || "";
  const finish = data.choices?.[0]?.finish_reason || "unknown";
  const tokensIn = usage.prompt_tokens || estimateTokens(prompt.length);
  const tokensOut = usage.completion_tokens || estimateTokens(content.length);
  const pricing = PRICING_MAP[modelId];
  const costEst = pricing ? (tokensIn / 1e6) * pricing.prom + (tokensOut / 1e6) * pricing.comp : 0;
  const tokPerSec = elapsed > 0 ? Math.round((tokensOut / elapsed) * 1000) : 0;
  return { ok: true, elapsed, content, tokensIn, tokensOut, tokPerSec, costEst, finish, promptLen: prompt.length, responseLen: content.length };
}
async function run() {
  const results = [];
  for (const tier of TIERS) {
    const modelId = MODEL_IDS[tier];
    console.log("\n--- Tier: " + tier + " (" + modelId + ") ---");
    for (const sc of scenarios.scenarios) {
      process.stdout.write("  \"" + sc.id + "\" [" + sc.category + "]... ");
      const res = await fetchModel(modelId, sc.prompt, sc.expected_length_chars);
      if (!res.ok) {
        console.log("ERR " + res.elapsed + "ms " + res.error);
        results.push({ ts: new Date().toISOString(), event: "benchmark-token-latency", t: tier, m: modelId, s: sc.id, category: sc.category, latency_ms: res.elapsed, error: res.error });
        continue;
      }
      console.log("OK " + res.elapsed + "ms  " + res.tokensIn + "->" + res.tokensOut + " tok  " + res.tokPerSec + " tok/s  $" + res.costEst.toFixed(5) + "  [" + res.finish + "]");
      results.push({ ts: new Date().toISOString(), event: "benchmark-token-latency", t: tier, m: modelId, s: sc.id, category: sc.category, prompt_len: res.promptLen, response_len: res.responseLen, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.elapsed, tok_per_sec: res.tokPerSec, cost_est: res.costEst, finish_reason: res.finish, error: null });
    }
  }
  for (const r of results) appendFileSync(BENCH_LOG, JSON.stringify(r) + "\n");
  const ok = results.filter(r => !r.error);
  const errs = results.filter(r => r.error);
  const totals = { tokens_in: ok.reduce((s, r) => s + (r.tokens_in || 0), 0), tokens_out: ok.reduce((s, r) => s + (r.tokens_out || 0), 0), avg_latency: ok.length > 0 ? Math.round(ok.reduce((s, r) => s + r.latency_ms, 0) / ok.length) : 0, cost: ok.reduce((s, r) => s + (r.cost_est || 0), 0) };
  for (const tier of TIERS) {
    const tResults = ok.filter(r => r.t === tier);
    if (tResults.length === 0) continue;
    const avgLat = Math.round(tResults.reduce((s, r) => s + r.latency_ms, 0) / tResults.length);
    const avgTps = Math.round(tResults.reduce((s, r) => s + (r.tok_per_sec || 0), 0) / tResults.length);
    console.log(tier + ": " + tResults.length + " runs, avg " + avgLat + "ms, avg " + avgTps + " tok/s, " + tResults.reduce((s, r) => s + (r.tokens_out || 0), 0) + " tok out");
  }
  console.log("\nTotal: " + ok.length + " OK, " + errs.length + " errors | " + totals.tokens_in + " in / " + totals.tokens_out + " out | avg " + totals.avg_latency + "ms | $" + totals.cost.toFixed(6));
  const report = { meta: { generated_at: new Date().toISOString(), version: "1.0", schema: "vibeos-token-latency-v1" }, tiers: TIERS.map(t => ({ tier: t, model: MODEL_IDS[t] })), scenarios: results, summary: { total_ok: ok.length, total_errors: errs.length, total_tokens_in: totals.tokens_in, total_tokens_out: totals.tokens_out, avg_latency_ms: totals.avg_latency, total_cost_est: totals.cost } };
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = join(REPORT_DIR, "token-latency-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z.json");
  appendFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log("\nReport saved: " + reportFile);
}
run().catch(console.error);
