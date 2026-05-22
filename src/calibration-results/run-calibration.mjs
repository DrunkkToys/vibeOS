#!/usr/bin/env node
import { writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ResolutionTracker } from "../vibeOS-lib/blackbox/resolution-tracker.js"

const __dirname2 = fileURLToPath(import.meta.url).replace(/[^/]+$/, "")
const OUT_DIR = __dirname2.replace(/\/$/, "")
const TS = new Date().toISOString().replace(/[:.]/g, "-")

const DIALOGUES = {
  "loop-3": { turns: ["I keep going back and forth on this same decision over and over again","Let me think about this differently maybe approach from another angle","I still cant decide between the two options they both have pros and cons","Actually going back to what I said earlier maybe the first option is better","I keep going back and forth on this same decision over and over again"], expected: "LOOPING" },
  "loop-5": { turns: ["I need help with my react app routing configuration","Let me check the react-router documentation for the v6 API changes","Actually I think the issue might be with how Im nesting routes","Going back to the original problem maybe I should restructure the app","I keep going back and forth on this same decision over and over again","Let me think about this differently maybe approach from another angle","I still cant decide between the two options they both have pros and cons"], expected: "LOOPING" },
  "converge-linear": { turns: ["I need to set up authentication for my Express API","Looking at JWT libraries for Node.js","Ill use jsonwebtoken with the standard middleware pattern","Writing the auth middleware now with token verification","Auth system is done and tested with all routes protected"], expected: "CLOSED" },
  "converge-refined": { turns: ["Im trying to optimize my PostgreSQL queries theyre slow","Added indexes on the join columns and it helped a bit","Actually I think the N+1 problem is the real issue here","Using eager loading with Knex to batch the related queries","Query time dropped from 2s to 50ms after fixing the eager loading"], expected: "CLOSED" },
  "diverge-uncertain": { turns: ["I need to choose a state management library for my React app","Redux is too verbose but Zustand seems too simple","Maybe I should look at Jotai or Recoil for atomic state","Actually React Context might be enough for this use case","Or should I use React Query for server state and keep local state simple","This is getting confusing every library has different tradeoffs"], expected: "DIVERGENT" },
  "pivot-switch": { turns: ["Im building a REST API with Express.js","Setting up the routes and middleware structure","I think I should switch to GraphQL instead itll handle the nested data better","GraphQL schemas are more flexible for complex queries","Apollo Server setup is done with the schema definitions"], expected: ["CONVERGING","REFINING"] },
  "explore-research": { turns: ["Im comparing different CI/CD platforms for my startup","GitHub Actions is free for public repos but limited","CircleCI has better caching but costs more","Jenkins is free but needs self-hosting infrastructure","GitLab CI seems like a good middle ground"], expected: ["EXPLORING","DIVERGENT"] },
}

const SWEEP = [
  // Baseline: current defaults
  { label: "baseline", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  // Loop sensitivity + shorter window for short dialogues
  { label: "loop-strict", lj: 0.4, cl: 0.7, lk: 2, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  { label: "loop-loose", lj: 0.8, cl: 0.7, lk: 4, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  // Closure ease: lower barriers so CLOSED fires on real data
  { label: "closure-easy", lj: 0.6, cl: 0.65, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.15, cc: 0.15, ce: 0.7, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  { label: "closure-hard", lj: 0.6, cl: 0.8, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.05, cc: 0.05, ce: 0.3, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  // Divergence detection: lower threshold for earlier diverge
  { label: "diverge-early", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.015, dc: 0.2, ec: 0.2, ee: 0.005 },
  // Exploring barrier: more exploring = less converging
  { label: "explore-high", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.1, ee: 0.003 },
  { label: "explore-low", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.3, 0.5, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.35, ee: 0.01 },
  // Momentum variants
  { label: "mom-entropy", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.5, 0.4, 0.1], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  { label: "mom-consist", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.1, 0.7, 0.2], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  { label: "mom-delta", lj: 0.6, cl: 0.7, lk: 3, mw: [-0.2, 0.3, 0.5], cd: 0.1, cc: 0.1, ce: 0.5, de: 0.03, dc: 0.3, ec: 0.2, ee: 0.005 },
  // Extreme combos
  { label: "aggressive", lj: 0.3, cl: 0.9, lk: 2, mw: [-0.5, 0.6, -0.1], cd: 0.2, cc: 0.2, ce: 0.8, de: 0.01, dc: 0.15, ec: 0.1, ee: 0.002 },
  { label: "hyper-sensitive", lj: 0.3, cl: 0.5, lk: 2, mw: [-0.5, 0.5, 0.0], cd: 0.25, cc: 0.25, ce: 0.9, de: 0.008, dc: 0.1, ec: 0.05, ee: 0.001 },
  { label: "hyper-stable", lj: 0.9, cl: 0.9, lk: 4, mw: [0.0, 0.7, 0.3], cd: 0.05, cc: 0.05, ce: 0.2, de: 0.05, dc: 0.5, ec: 0.4, ee: 0.02 },
]

function run() {
  const allExamples = []
  const summary = []

  for (const s of SWEEP) {
    let correct = 0, tp = 0, fp = 0, totalExpectedLoop = 0, pivots = 0

    for (const [name, d] of Object.entries(DIALOGUES)) {
      const tr = new ResolutionTracker(`cal-${s.label}-${name}`)
      tr.setCalibratedWeights({ momentum: s.mw, subRegime: {}, loopJaccard: s.lj, loopK: s.lk, closureConfidence: s.cl, closedDelta: s.cd, closedContradiction: s.cc, closedEntropy: s.ce, divergentEntropyTrend: s.de, divergentContradiction: s.dc, exploringContradiction: s.ec, exploringEntropyTrend: s.ee })

      for (let i = 0; i < d.turns.length; i++) {
        const entropy = Math.max(0.1, 1.5 - (i / d.turns.length) * 1.0)
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
          expected: Array.isArray(d.expected) ? d.expected.join("|") : d.expected,
          dialogue: name, sweep: s.label, turn: i + 1,
        })
      }

      const final = tr.snapshot()
      const isCorrect = final.sub_regime === d.expected || (Array.isArray(d.expected) && d.expected.includes(final.sub_regime))
      if (isCorrect) correct++

      const expectLoop = d.expected === "LOOPING" || (Array.isArray(d.expected) && d.expected.includes("LOOPING"))
      if (expectLoop) { totalExpectedLoop++; if (final.is_looping) tp++ }
      else { if (final.is_looping) fp++ }
      if (final.pivot_detected) pivots++
    }

    const nDialogue = Object.keys(DIALOGUES).length
    summary.push({
      label: s.label, lj: s.lj, lk: s.lk, cl: s.cl, cd: s.cd, de: s.de, ec: s.ec, mw: `[${s.mw.join(",")}]`,
      acc: Math.round(correct/nDialogue*1000)/10,
      prec: Math.round(tp/Math.max(tp+fp,1)*1000)/10,
      rec: Math.round(tp/Math.max(totalExpectedLoop,1)*1000)/10,
      pivots,
    })
  }

  const t = TS
  const mdPath = join(OUT_DIR, `calibration-${t}.md`)
  const jlPath = join(OUT_DIR, `training-${t}.jsonl`)
  const md = ["# Calibration Sweep Results","",`Run: ${new Date().toISOString()}`,"","Label|LoopJac|Closure|Momentum|Acc|Prec|Rec|Pivots","---|---|---|---|---|---|---|---|---"]
  for (const s of summary) md.push(`${s.label}|${s.lj}|${s.cl}|${s.mw}|${s.acc}%|${s.prec}%|${s.rec}%|${s.pivots}`)
  const sorted = [...summary].sort((a,b) => (b.acc+b.prec) - (a.acc+a.prec))
  md.push("","## Best:",`**${sorted[0].label}**: acc=${sorted[0].acc}%, prec=${sorted[0].prec}%, rec=${sorted[0].rec}%, lj=${sorted[0].lj}, cl=${sorted[0].cl}, mw=${sorted[0].mw}`)
  writeFileSync(mdPath, md.join("\n"))
  for (const ex of allExamples) appendFileSync(jlPath, JSON.stringify(ex)+"\n")
  console.log(`Saved: ${mdPath}`)
  console.log(`Saved: ${jlPath} (${allExamples.length} rows)`)
  console.log(md.join("\n"))
}
run()
