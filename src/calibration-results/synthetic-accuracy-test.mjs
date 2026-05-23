// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Embedded template gating (exact match of src/lib/templates.ts) ──

const DEFAULT_TEMPLATE = "save";

function detectBudgetSignal(creditPercent) {
  return creditPercent < 40;
}

let _prevStress = 0;
function detectStressSpike(stressScore) {
  const delta = stressScore - _prevStress;
  _prevStress = stressScore;
  return delta > 0.3 && stressScore > 0.5;
}

function resolveTemplate(prevTemplate, stressScore, unusedUserText, creditPercent) {
  if (detectBudgetSignal(creditPercent)) return "save";
  if (detectStressSpike(stressScore)) return "quality";
  return prevTemplate || DEFAULT_TEMPLATE;
}

let _turnCount = 0;
function shouldInjectTemplate(template, prevTemplate) {
  _turnCount++;
  if (template !== prevTemplate) return true;
  if (_turnCount % 10 === 0) return true;
  return false;
}

function resetState() {
  _prevStress = 0;
  _turnCount = 0;
}

// ── Load synthetic data ──

const dataPath = join(__dirname, "synthetic-accuracy-data.jsonl");
const raw = readFileSync(dataPath, "utf-8").trim();
const turns = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));

console.log(`Loaded ${turns.length} synthetic turns\n`);

// ── Turn-by-turn simulation ──

resetState();

let prevTemplate = null;
let currentTemplate = null;

const results = []; // per-turn detail

let accuracyCorrect = 0;
let totalInjections = 0;
let correctInjections = 0;
let totalTemplateChanges = 0;
let injectionsOnChange = 0;       // recall numerator
let falsePositives = 0;           // injected but no change and not periodic
let falseNegatives = 0;           // changed but not injected
let totalTurns = turns.length;

// For per-class metrics
const classMetrics = {
  save:    { total: 0, correct: 0, injections: 0, correctInjections: 0 },
  quality: { total: 0, correct: 0, injections: 0, correctInjections: 0 }
};

for (const turn of turns) {
  const { turn: turnNum, user_message, expected_template, stress_score, credit_percent } = turn;

  currentTemplate = resolveTemplate(prevTemplate, stress_score, user_message, credit_percent);
  const injected = shouldInjectTemplate(currentTemplate, prevTemplate);
  const templateChanged = currentTemplate !== prevTemplate;
  const isPeriodic = _turnCount % 10 === 0;
  const isCorrect = currentTemplate === expected_template;

  // ── Template accuracy ──
  if (isCorrect) accuracyCorrect++;

  // ── Injection precision ──
  if (injected) {
    totalInjections++;
    if (isCorrect) correctInjections++;
  }

  // ── Injection recall ──
  if (templateChanged) {
    totalTemplateChanges++;
    if (injected) injectionsOnChange++;
    else falseNegatives++;
  }

  // ── False positives (injected when not changed and not periodic) ──
  if (injected && !templateChanged && !isPeriodic) {
    falsePositives++;
  }

  // ── Per-class tracking ──
  if (classMetrics[currentTemplate]) {
    classMetrics[currentTemplate].total++;
    if (isCorrect) classMetrics[currentTemplate].correct++;
    if (injected) {
      classMetrics[currentTemplate].injections++;
      if (isCorrect) classMetrics[currentTemplate].correctInjections++;
    }
  }

  results.push({
    turn: turnNum,
    expected: expected_template,
    actual: currentTemplate,
    injected,
    correct: isCorrect,
    changed: templateChanged,
    periodic: isPeriodic,
    prevTemplate,
    stress_score,
    credit_percent
  });

  prevTemplate = currentTemplate;
}

// ── Compute metrics ──

const accuracyPct = ((accuracyCorrect / totalTurns) * 100).toFixed(1);
const precisionPct = totalInjections > 0 ? ((correctInjections / totalInjections) * 100).toFixed(1) : "N/A";
const recallPct = totalTemplateChanges > 0 ? ((injectionsOnChange / totalTemplateChanges) * 100).toFixed(1) : "N/A";

// For FPR: denominator is turns where injection was "not needed" (no change, not periodic)
// For FNR: denominator is turns where injection was "needed" (template changed)
const notNeededTurns = totalTurns - totalTemplateChanges;
const fprPct = notNeededTurns > 0 ? ((falsePositives / notNeededTurns) * 100).toFixed(1) : "N/A";
const fnrPct = totalTemplateChanges > 0 ? ((falseNegatives / totalTemplateChanges) * 100).toFixed(1) : "N/A";

// ── Per-class accuracy ──
const classRows = [];
for (const [cls, m] of Object.entries(classMetrics)) {
  const acc = m.total > 0 ? ((m.correct / m.total) * 100).toFixed(1) : "N/A";
  const prec = m.injections > 0 ? ((m.correctInjections / m.injections) * 100).toFixed(1) : "N/A";
  classRows.push({ class: cls, total: m.total, correct: m.correct, accuracy: acc, injections: m.injections, precision: prec });
}

// ── Find mismatches for diagnostics ──
const mismatches = results.filter(r => !r.correct);

// ── ASCII Output ──

console.log("=".repeat(72));
console.log("  SYNTHETIC ACCURACY TEST — Template Gating System");
console.log("=".repeat(72));
console.log("  Data: synthetic-accuracy-data.jsonl  |  Turns: " + totalTurns);
console.log("  Templates: SAVE | QUALITY");
console.log("  Gating:  budget(credit<40) > stress-spike > default(save)");
console.log("  Injection: on template change OR every 10 turns (reinforcement)");
console.log("-".repeat(72));

console.log("\n  ── GLOBAL METRICS ──\n");

console.log("  Template Accuracy:         ".padEnd(34) + `${accuracyPct}%  (${accuracyCorrect}/${totalTurns})`);
console.log("  Injection Precision:       ".padEnd(34) + `${precisionPct}%  (${correctInjections}/${totalInjections})`);
console.log("  Injection Recall:          ".padEnd(34) + `${recallPct}%  (${injectionsOnChange}/${totalTemplateChanges})`);
console.log("  False Positive Rate:       ".padEnd(34) + `${fprPct}%  (${falsePositives}/${notNeededTurns})`);
console.log("  False Negative Rate:       ".padEnd(34) + `${fnrPct}%  (${falseNegatives}/${totalTemplateChanges})`);

console.log("\n  ── PER-CLASS BREAKDOWN ──\n");
console.log("  " + "Template".padEnd(12) + "Turns".padEnd(8) + "Correct".padEnd(10) + "Accuracy".padEnd(12) + "Injections".padEnd(12) + "Inj.Prec.");
console.log("  " + "-".repeat(66));
for (const row of classRows) {
  console.log("  " + row.class.padEnd(12) + String(row.total).padEnd(8) + String(row.correct).padEnd(10) + 
    (row.accuracy + "%").padEnd(12) + String(row.injections).padEnd(12) + (row.precision + "%"));
}

console.log("\n  ── STATE CHANGES ──\n");
console.log(`  Total template changes: ${totalTemplateChanges}`);
console.log(`  Total injections fired: ${totalInjections}`);
console.log(`  Periodic injections:    ${results.filter(r => r.periodic && r.injected).length}`);

if (mismatches.length > 0) {
  console.log("\n  ── MISMATCHES (actual ≠ expected) ──\n");
  console.log("  " + "Turn".padEnd(6) + "Expected".padEnd(12) + "Actual".padEnd(12) + "Credit".padEnd(8) + "Stress".padEnd(8) + "Injected".padEnd(10) + "Changed");
  console.log("  " + "-".repeat(70));
  for (const m of mismatches) {
    console.log("  " + String(m.turn).padEnd(6) + m.expected.padEnd(12) + m.actual.padEnd(12) + 
      String(m.credit_percent).padEnd(8) + String(m.stress_score).padEnd(8) + String(m.injected).padEnd(10) + String(m.changed));
  }
} else {
  console.log("\n  ── ALL TURNS MATCH EXPECTED — NO MISMATCHES ──\n");
}

console.log("\n" + "=".repeat(72));

// ── Per-turn detail table (first 20 and last 10 for brevity in console) ──
console.log("\n  ── PER-TURN DETAIL (sample) ──\n");
console.log("  " + "#".padEnd(5) + "Expected".padEnd(12) + "Actual".padEnd(12) + "OK".padEnd(5) + "Inj".padEnd(5) + "Chg".padEnd(5) + "P10".padEnd(5));
console.log("  " + "-".repeat(54));
for (const r of results.slice(0, 20)) {
  console.log("  " + String(r.turn).padEnd(5) + r.expected.padEnd(12) + r.actual.padEnd(12) + 
    (r.correct ? "YES" : "NO ").padEnd(5) + (r.injected ? "Y" : "N").padEnd(5) + 
    (r.changed ? "Y" : "N").padEnd(5) + (r.periodic ? "Y" : "N"));
}
console.log("  ...");
for (const r of results.slice(-10)) {
  console.log("  " + String(r.turn).padEnd(5) + r.expected.padEnd(12) + r.actual.padEnd(12) + 
    (r.correct ? "YES" : "NO ").padEnd(5) + (r.injected ? "Y" : "N").padEnd(5) + 
    (r.changed ? "Y" : "N").padEnd(5) + (r.periodic ? "Y" : "N"));
}

// ── Save results ──

const summary = {
  test_name: "synthetic-accuracy-test",
  generated_at: new Date().toISOString(),
  total_turns: totalTurns,
  global: {
    template_accuracy_pct: parseFloat(accuracyPct),
    accuracy_correct: accuracyCorrect,
    accuracy_total: totalTurns,
    injection_precision_pct: totalInjections > 0 ? parseFloat(precisionPct) : null,
    injection_precision_correct: correctInjections,
    injection_precision_total: totalInjections,
    injection_recall_pct: totalTemplateChanges > 0 ? parseFloat(recallPct) : null,
    injection_recall_hits: injectionsOnChange,
    injection_recall_total: totalTemplateChanges,
    false_positive_rate_pct: notNeededTurns > 0 ? parseFloat(fprPct) : null,
    false_positives: falsePositives,
    false_negative_rate_pct: totalTemplateChanges > 0 ? parseFloat(fnrPct) : null,
    false_negatives: falseNegatives,
    total_injections: totalInjections,
    total_changes: totalTemplateChanges,
    periodic_injections: results.filter(r => r.periodic && r.injected).length
  },
  per_class: {},
  mismatches: mismatches.length,
  mismatch_details: mismatches.slice(0, 20).map(m => ({
    turn: m.turn,
    expected: m.expected,
    actual: m.actual,
    credit: m.credit_percent,
    stress: m.stress_score
  }))
};

for (const row of classRows) {
  summary.per_class[row.class] = {
    turns: row.total,
    correct: row.correct,
    accuracy_pct: parseFloat(row.accuracy),
    injections: row.injections,
    injection_precision_pct: row.precision === "N/A" ? null : parseFloat(row.precision)
  };
}

const outPath = join(__dirname, "synthetic-accuracy-results.json");
writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf-8");
console.log(`\nResults saved to: ${outPath}\n`);
