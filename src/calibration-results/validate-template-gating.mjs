#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAL_FILE = join(homedir(), ".claude", "calibration-data.jsonl");

const TEMPLATES = {
  save: { name: "save" },
  quality: { name: "quality" },
};

let _turnCount = 0;
function shouldInjectTemplate(template, prevTemplate) {
  _turnCount++;
  if (template !== prevTemplate) return true;
  if (_turnCount % 10 === 0) return true;
  return false;
}

let _prevStress = 0;
function detectStressSpike(stressScore) {
  const delta = stressScore - _prevStress;
  _prevStress = stressScore;
  return delta > 0.3 && stressScore > 0.5;
}

function detectBudgetSignal(creditPercent) {
  return creditPercent < 40;
}

function resolveTemplate(prevTemplate, stressScore, userText, creditPercent) {
  if (detectBudgetSignal(creditPercent)) return "save";
  if (detectStressSpike(stressScore)) return "quality";
  return prevTemplate || "save";
}

// ── Load calibration data ──
let lines;
try {
  lines = readFileSync(CAL_FILE, "utf-8").split("\n").filter(l => l.trim());
} catch (e) {
  console.error("calibration-data.jsonl not found at " + CAL_FILE);
  process.exit(1);
}

const turns = lines.map(l => JSON.parse(l));
console.log(`Loaded ${turns.length} turns from calibration-data.jsonl\n`);

// ── Simulate template gating ──
let _prevTemplate = null;
let _currentTemplate = "save";
let _prevRegime = null;
let _regimeChanges = 0;
let _stressSpikes = 0;
let _securitySignals = 0;
let _templateInjections = 0;
let _blackboxInjections = 0;
let _stressInjections = 0;
let _projectGuardInjections = 0;
let _context7Injections = 0;

const TOTAL_TURNS = turns.length;

// Current system estimates (every-turn injection for mode, blackbox, stress, guard, context7)
const CURRENT_INJECTIONS = {
  mode: TOTAL_TURNS,
  blackbox: TOTAL_TURNS,
  stress: 0,
  guard: TOTAL_TURNS,
  context7: TOTAL_TURNS,
};

for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  const stressScore = t.stress || 0;
  const regime = t.regime || "UNKNOWN";
  const mode = t.mode || "auto";

  // Template gating
  _prevTemplate = _currentTemplate;
  _currentTemplate = resolveTemplate(_prevTemplate, stressScore, mode, 100);
  if (shouldInjectTemplate(_currentTemplate, _prevTemplate)) {
    _templateInjections++;
  }

  // Blackbox — only on regime change
  if (regime !== _prevRegime) {
    _prevRegime = regime;
    _blackboxInjections++;
    _regimeChanges++;
  }

  // Stress — only on spike
  if (stressScore > 0.4 && detectStressSpike(stressScore)) {
    _stressInjections++;
    _stressSpikes++;
  }

  // Project guard — every 5 turns
  if ((i + 1) % 5 === 0) {
    _projectGuardInjections++;
  }

  // Context7 — every 5 turns
  if ((i + 1) % 5 === 0) {
    _context7Injections++;
  }

  // Security signals removed — no longer tracked

  // Update stress tracker for sustained stress count (current system)
  if (stressScore > 0.4) CURRENT_INJECTIONS.stress++;
}

// ── Results ──
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║  TEMPLATE GATING VALIDATION — PRODUCTION DATA REPLAY    ║");
console.log("╚══════════════════════════════════════════════════════════╝\n");

console.log(`Turns analyzed: ${TOTAL_TURNS}`);
console.log(`Template changes: ${_templateInjections - Math.floor(TOTAL_TURNS / 10)} (transition)`);
console.log(`Stress spikes detected: ${_stressSpikes}`);
console.log(`Security signals: ${_securitySignals}`);
console.log(`Regime changes: ${_regimeChanges} (${(_regimeChanges / TOTAL_TURNS * 100).toFixed(1)}%)\n`);

console.log("┌─────────────────────┬──────────┬──────────┬──────────┐");
console.log("│ Directive           │ Current  │ Proposed │ Reduction│");
console.log("├─────────────────────┼──────────┼──────────┼──────────┤");
const rows = [
  ["Mode paragraph     ", CURRENT_INJECTIONS.mode, _templateInjections],
  ["Blackbox status    ", CURRENT_INJECTIONS.blackbox, _blackboxInjections],
  ["Stress mitigation  ", CURRENT_INJECTIONS.stress, _stressInjections],
  ["Project guard      ", CURRENT_INJECTIONS.guard, _projectGuardInjections],
  ["Context7 cost policy", CURRENT_INJECTIONS.context7, _context7Injections],
];

const CHARS_PER_INJECT = { mode: 400, blackbox: 180, stress: 300, guard: 250, context7: 180 };
let totalCurrent = 0;
let totalProposed = 0;

for (const [label, current, proposed] of rows) {
  const key = label.trim().split(" ")[0].toLowerCase();
  const pct = current > 0 ? ((1 - proposed / current) * 100).toFixed(1) : "0.0";
  totalCurrent += current * (CHARS_PER_INJECT[key] || 1);
  totalProposed += proposed * (CHARS_PER_INJECT[key] || 1);
  console.log(`│ ${label} │ ${String(current).padStart(8)} │ ${String(proposed).padStart(8)} │ ${String(pct + "%").padStart(7)} │`);
}
console.log("├─────────────────────┴──────────┴──────────┴──────────┤");
const overallPct = ((1 - totalProposed / totalCurrent) * 100).toFixed(1);
console.log(`│ Total chars injected: ${totalCurrent.toLocaleString()} → ${totalProposed.toLocaleString()} (${overallPct}% reduction)     │`);
console.log("└──────────────────────────────────────────────────────┘\n");

// ── Confidence assessment ──
let concerns = [];
if (_securitySignals > 0 && _templateInjections > TOTAL_TURNS * 0.5) {
  concerns.push("Security signals detected but template still injecting frequently — review gating thresholds");
}
if (_stressSpikes / Math.max(_templateInjections, 1) > 0.5) {
  concerns.push("Stress spikes too frequent — consider raising delta threshold");
}
if (_templateInjections < 5) {
  concerns.push("WARNING: Template injections extremely low — directives may be missing entirely");
}

if (concerns.length > 0) {
  console.log("Concerns:");
  for (const c of concerns) console.log("  * " + c);
} else {
  console.log("No concerns detected. Gating is within healthy bounds.");
}

console.log(`\nValidation complete. Reduction: ${overallPct}%`);

// ── Save report ──
const report = {
  ts: new Date().toISOString(),
  turns: TOTAL_TURNS,
  current_injections: CURRENT_INJECTIONS,
  proposed_injections: {
    mode: _templateInjections,
    blackbox: _blackboxInjections,
    stress: _stressInjections,
    guard: _projectGuardInjections,
    context7: _context7Injections,
  },
  signals: {
    stress_spikes: _stressSpikes,
    security_signals: _securitySignals,
    regime_changes: _regimeChanges,
  },
  total_chars_current: totalCurrent,
  total_chars_proposed: totalProposed,
  reduction_pct: parseFloat(overallPct),
};
const outPath = join(__dirname, `gate-validation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Report saved: ${outPath}`);
