#!/usr/bin/env node
// Calibration pipeline: reads calibration-data.jsonl, aggregates mode×regime→outcome,
// generates updated mode weights, writes to project-states.json + prints recommendations.
// Usage: node scripts/calibrate-modes.mjs
//        DRY_RUN=true node scripts/calibrate-modes.mjs  # no write

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const HOME = homedir()
const CAL_FILE = join(HOME, ".claude", "calibration-data.jsonl")
const STATE_FILE = join(HOME, ".claude", "delegation-state.json")
const PROJECT_FILE = join(HOME, ".claude", "project-states.json")

const DRY_RUN = process.env.DRY_RUN === "true"

// ── Load calibration data ────────────────────────────────────────────
function loadAll() {
  if (!existsSync(CAL_FILE)) { console.log("No calibration data."); process.exit(0) }
  const lines = readFileSync(CAL_FILE, "utf-8").trim().split("\n").filter(Boolean)
  const modeEvents = []  // { ts, sid, mode, regime, stress, fp }
  const outcomeEvents = []  // { ts, sid, outcome }
  for (const l of lines) {
    try {
      const e = JSON.parse(l)
      if (e.event === "outcome") outcomeEvents.push(e)
      else if (e.mode && e.regime) modeEvents.push(e)
    } catch {}
  }
  return { modeEvents, outcomeEvents, totalLines: lines.length }
}

// ── Match outcomes to prior mode events ──────────────────────────────
function matchOutcomes(modeEvents, outcomeEvents) {
  // For each outcome, find the most recent mode event with the same sid that came BEFORE it
  const matched = []
  for (const oc of outcomeEvents) {
    const prior = modeEvents
      .filter(m => m.sid === oc.sid && new Date(m.ts) < new Date(oc.ts))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    if (prior.length > 0) {
      matched.push({ ...prior[0], outcome: oc.outcome, outcomeTs: oc.ts })
    } else {
      matched.push({ mode: "unknown", regime: "unknown", stress: 0, fp: "", outcome: oc.outcome, outcomeTs: oc.ts })
    }
  }
  return matched
}

// ── Aggregate effectiveness ──────────────────────────────────────────
function aggregate(matched) {
  const byModeRegime = {}  // "mode::regime" => { positive, negative, total, stresses }
  for (const m of matched) {
    const key = `${m.mode}::${m.regime}`
    if (!byModeRegime[key]) byModeRegime[key] = { mode: m.mode, regime: m.regime, positive: 0, negative: 0, total: 0, stressSum: 0 }
    byModeRegime[key].total++
    byModeRegime[key].stressSum += m.stress || 0
    if (m.outcome === "positive") byModeRegime[key].positive++
    else if (m.outcome === "negative") byModeRegime[key].negative++
  }

  // By regime: find best mode
  const byRegime = {}
  for (const [key, val] of Object.entries(byModeRegime)) {
    const r = val.regime
    if (!byRegime[r]) byRegime[r] = []
    const score = val.total > 0 ? (val.positive - val.negative) / val.total : 0
    byRegime[r].push({ ...val, effectiveness: score })
  }

  for (const r of Object.keys(byRegime)) {
    byRegime[r].sort((a, b) => b.effectiveness - a.effectiveness)
  }

  return { byModeRegime, byRegime }
}

// ── Generate updated mapping ─────────────────────────────────────────
function generateMapping(byRegime) {
  const mapping = {
    LOOPING: "forensic",
    DIVERGENT: "forensic",
    EXPLORING: "web-research",
    INIT: "web-research",
    REFINING: "balanced",
    CONVERGING: "quality",
    CLOSED: "quality",
  }

  let changed = 0
  for (const [regime, ranked] of Object.entries(byRegime)) {
    if (ranked.length === 0) continue
    const best = ranked[0]
    const current = mapping[regime]
    if (best.effectiveness > 0.1 && best.mode !== current) {
      console.log(`  ${regime.padEnd(12)} ${current.padEnd(14)} → ${best.mode.padEnd(14)} (score=${best.effectiveness.toFixed(3)}, n=${best.total})`)
      mapping[regime] = best.mode
      changed++
    }
  }
  if (changed === 0) console.log("  No changes needed — current mapping is optimal")
  return { mapping, changed }
}

// ── Write updated weights ────────────────────────────────────────────
function writeCalibration(mapping) {
  const file = join(HOME, ".claude", "mode-calibration-weights.json")
  const data = {
    generated_at: new Date().toISOString(),
    regime_mode_map: mapping,
    version: 1,
  }
  mkdirSync(join(HOME, ".claude"), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n")
  return file
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  console.log("=== Mode Calibration Pipeline ===\n")

  const { modeEvents, outcomeEvents, totalLines } = loadAll()
  console.log(`Calibration data: ${totalLines} events`)
  console.log(`  Mode selections: ${modeEvents.length}`)
  console.log(`  Outcome signals: ${outcomeEvents.length}\n`)

  if (outcomeEvents.length < 3) {
    console.log("Not enough outcome data (need ≥3). Keep using the system to collect more.")
    process.exit(0)
  }

  const matched = matchOutcomes(modeEvents, outcomeEvents)
  console.log(`Matched ${matched.length} outcome→mode pairs\n`)

  const { byModeRegime, byRegime } = aggregate(matched)

  // Print per-mode-regime effectiveness
  console.log("Per mode×regime effectiveness:")
  console.log(`${"Mode".padEnd(16)} ${"Regime".padEnd(12)} ${"Pos".padEnd(5)} ${"Neg".padEnd(5)} ${"Total".padEnd(6)} ${"Score".padEnd(8)} ${"Avg stress".padEnd(10)}`)
  console.log("-".repeat(60))
  for (const [key, val] of Object.entries(byModeRegime)) {
    const [mode, regime] = key.split("::")
    const score = val.total > 0 ? ((val.positive - val.negative) / val.total).toFixed(3) : "?.???"
    const avgStress = val.total > 0 ? (val.stressSum / val.total).toFixed(2) : "?.??"
    console.log(`${mode.padEnd(16)} ${regime.padEnd(12)} ${val.positive.toString().padEnd(5)} ${val.negative.toString().padEnd(5)} ${val.total.toString().padEnd(6)} ${score.toString().padEnd(8)} ${avgStress.toString().padEnd(10)}`)
  }

  // Per-regime winner
  console.log("\nPer-regime best mode:")
  console.log(`${"Regime".padEnd(12)} ${"Current".padEnd(14)} ${"Best".padEnd(14)} ${"Score".padEnd(8)} ${"N".padEnd(4)}`)
  console.log("-".repeat(50))
  const currentMap = { LOOPING:"forensic", DIVERGENT:"forensic", EXPLORING:"web-research", INIT:"web-research", REFINING:"balanced", CONVERGING:"quality", CLOSED:"quality" }
  for (const [regime, ranked] of Object.entries(byRegime).sort()) {
    if (ranked.length === 0) continue
    const best = ranked[0]
    console.log(`${regime.padEnd(12)} ${currentMap[regime]?.padEnd(14) || "?".padEnd(14)} ${best.mode.padEnd(14)} ${best.effectiveness.toFixed(3).padEnd(8)} ${best.total.toString().padEnd(4)}`)
  }

  // Generate updated mapping
  console.log("\nUpdating regime→mode mapping:")
  const { mapping, changed } = generateMapping(byRegime)

  // Write if not dry run
  if (!DRY_RUN && changed > 0) {
    const path = writeCalibration(mapping)
    console.log(`\nWritten to ${path}`)
    console.log("Run with DRY_RUN=true to preview without writing")
  } else if (DRY_RUN) {
    console.log("\n[DRY RUN] No files written.")
  } else {
    console.log("\nNo updates needed.")
  }

  // Summary
  console.log(`\n=== Summary ===`)
  console.log(`Total matched outcomes: ${matched.length}`)
  const pos = matched.filter(m => m.outcome === "positive").length
  const neg = matched.filter(m => m.outcome === "negative").length
  console.log(`Positive: ${pos} (${(pos/matched.length*100).toFixed(1)}%)`)
  console.log(`Negative: ${neg} (${(neg/matched.length*100).toFixed(1)}%)`)
  console.log(`Satisfaction rate: ${(pos/Math.max(1, matched.length)*100).toFixed(1)}%`)
}

main()
