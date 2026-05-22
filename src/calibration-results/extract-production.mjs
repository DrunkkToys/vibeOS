#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ResolutionTracker } from "../vibeOS-lib/blackbox/resolution-tracker.js"

const __dirname2 = fileURLToPath(import.meta.url).replace(/[^/]+$/, "")
const OUT = __dirname2.replace(/\/$/, "")
const TS = new Date().toISOString().replace(/[:.]/g, "-")

const bb = JSON.parse(readFileSync(process.env.HOME + "/.claude/blackbox-state.json", "utf-8"))
const sessions = bb.sessions || {}

// ── Extract real user dialogues from sessions with history ────────────
const realDialogues = []
for (const [sid, s] of Object.entries(sessions)) {
  if (s.history && s.history.length >= 3 && sid.endsWith("_opt")) continue
  if (s.history && s.history.length >= 3) {
    const turns = s.history.map(h => h.text)
    // Infer expected regime from loop count and turn pattern
    let expected = "CLOSED"
    const loopCount = s.loopCount || 0
    if (loopCount > 3 || (turns.length >= 4 && turns.slice(-3).every(t => turns.slice(-4, -1).includes(t)))) {
      expected = "LOOPING"
    } else if (turns.length >= 4) {
      const last = turns[turns.length - 1]
      const rest = turns.slice(0, -1)
      if (rest.some(t => t.includes("?")) && last.includes("?")) expected = "DIVERGENT"
      else if (rest.some(t => t !== last)) expected = "CONVERGING"
    }
    realDialogues.push({ sid, turns, expected, loopCount, slot: s.active_slot || "auto" })
  }
}

console.log(`Extracted ${realDialogues.length} real dialogues from production data`)

// ── Sweep every real dialogue through all threshold combos ────────────
const SWEEP = [
  { label: "baseline", lj: 0.6, cl: 0.7, mw: [-0.3, 0.5, 0.2] },
  { label: "loop-strict", lj: 0.4, cl: 0.7, mw: [-0.3, 0.5, 0.2] },
  { label: "loop-loose", lj: 0.8, cl: 0.7, mw: [-0.3, 0.5, 0.2] },
  { label: "closure-strict", lj: 0.6, cl: 0.85, mw: [-0.3, 0.5, 0.2] },
  { label: "closure-loose", lj: 0.6, cl: 0.55, mw: [-0.3, 0.5, 0.2] },
  { label: "mom-entropy", lj: 0.6, cl: 0.7, mw: [-0.5, 0.4, 0.1] },
  { label: "mom-consist", lj: 0.6, cl: 0.7, mw: [-0.1, 0.7, 0.2] },
  { label: "mom-delta", lj: 0.6, cl: 0.7, mw: [-0.2, 0.3, 0.5] },
  { label: "aggressive", lj: 0.3, cl: 0.9, mw: [-0.5, 0.6, -0.1] },
  { label: "hyper-sensitive", lj: 0.3, cl: 0.5, mw: [-0.5, 0.5, 0.0] },
  { label: "hyper-stable", lj: 0.9, cl: 0.9, mw: [0.0, 0.7, 0.3] },
]

const allExamples = []
const summary = []

for (const s of SWEEP) {
  let correct = 0, tp = 0, fp = 0, totalExpectedLoop = 0, pivots = 0

  for (const d of realDialogues) {
    const tr = new ResolutionTracker(`prod-${s.label}-${d.sid}`)
    tr.setCalibratedWeights({ momentum: s.mw, subRegime: {}, loopJaccard: s.lj, closureConfidence: s.cl })

    for (let i = 0; i < d.turns.length; i++) {
      const entropy = Math.max(0.1, 1.5 - (i / d.turns.length) * 1.0 + (Math.random() - 0.5) * 0.2)
      const uncertainty = Math.max(1, Math.round(60 - (i / d.turns.length) * 40))
      const features = ResolutionTracker.extractFeatures(d.turns[i])
      const actions = ["explore","act","defer","explore","act","commit","explore","defer"]
      const st = tr.update(d.turns[i], features, actions[i % actions.length], entropy, uncertainty)
      const sig = st.signals || {}
      const int = st.intent_state || {}
      const featRow = {
        action_consistency: sig.action_consistency ?? 0,
        entropy_trend: sig.entropy_trend ?? 0,
        feature_contradiction: sig.feature_contradiction ?? 0,
        embedding_delta: sig.embedding_delta ?? 0,
        momentum: st.momentum ?? 0,
        volatility: int.volatility_score ?? 0,
        drift_rate: int.drift_rate ?? 0,
        is_looping: st.is_looping ? 1 : 0,
        loop_consecutive: st.loop_consecutive ?? 0,
        pivot_score: st.pivot_score ?? 0,
        n_interactions: st.n_interactions ?? 0,
      }
      allExamples.push({
        features: featRow,
        regime: st.sub_regime,
        expected: d.expected,
        session: d.sid,
        sweep: s.label,
        turn: i + 1,
        loopCount: d.loopCount || 0,
        slot: d.slot,
      })
    }

    const final = tr.snapshot()
    const isCorrect = final.sub_regime === d.expected
    if (isCorrect) correct++

    const expectLoop = d.expected === "LOOPING" || d.expected === "DIVERGENT"
    if (expectLoop) { totalExpectedLoop++; if (final.is_looping) tp++ }
    else { if (final.is_looping) fp++ }
    if (final.pivot_detected) pivots++
  }

  const nDialogue = realDialogues.length
  summary.push({
    label: s.label, lj: s.lj, cl: s.cl, mw: `[${s.mw.join(",")}]`,
    acc: Math.round(correct/nDialogue*1000)/10,
    prec: Math.round(tp/Math.max(tp+fp,1)*1000)/10,
    rec: Math.round(tp/Math.max(totalExpectedLoop,1)*1000)/10,
    pivots,
    n: nDialogue,
  })
}

// ── Save ──────────────────────────────────────────────────────────────
const mdPath = join(OUT, `prod-sweep-${TS}.md`)
const jlPath = join(OUT, `prod-training-${TS}.jsonl`)
const md = [
  "# Production Blackbox Sweep Results",
  "", `Run: ${new Date().toISOString()}`,
  `Sessions with history: ${realDialogues.length}`,
  `Total turns: ${allExamples.length}`,
  "", "Label|LoopJac|Closure|Momentum|Acc|Prec|Rec|Pivots|Sessions",
  "---|---|---|---|---|---|---|---|---|---",
]
for (const s of summary) md.push(`${s.label}|${s.lj}|${s.cl}|${s.mw}|${s.acc}%|${s.prec}%|${s.rec}%|${s.pivots}|${s.n}`)
const sorted = [...summary].sort((a,b) => (b.acc+b.prec) - (a.acc+a.prec))
md.push("","## Best:", `**${sorted[0].label}**: acc=${sorted[0].acc}%, prec=${sorted[0].prec}%, rec=${sorted[0].rec}%, lj=${sorted[0].lj}, cl=${sorted[0].cl}, mw=${sorted[0].mw}`)
writeFileSync(mdPath, md.join("\n"))
for (const ex of allExamples) appendFileSync(jlPath, JSON.stringify(ex)+"\n")

console.log(`\nSaved: ${mdPath}`)
console.log(`Saved: ${jlPath} (${allExamples.length} examples)`)
console.log("\n" + md.slice(2).join("\n"))
