#!/usr/bin/env node
import { ResolutionTracker } from "../src/vibeOS-lib/blackbox/resolution-tracker.js";

const SEED = 42;
const ITERATIONS = 50;
const MAX_TURNS = 12;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function sample(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function gaussian(rng, mean = 0, std = 1) {
  const u1 = rng();
  const u2 = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

const exploringTexts = [
  "what about shifting up the model? can u try test a/b",
  "what can do to enhance this process",
  "I need to understand how this works first",
  "draft a solution for this implementation",
  "let me think about this differently",
  "what are the possible approaches here",
  "can you explain more about that",
  "I'm not sure, let me see what options exist",
  "what other ways could we solve this",
  "maybe we should look at this from another angle",
  "is there a library that already does this",
  "what does the documentation say about this",
  "how does this compare to the alternative approach",
  "I need more context before deciding",
  "let's explore all the edge cases first",
  "what happens if we try the opposite approach",
  "can you show me the relevant code sections",
  "I wonder if there's a simpler solution",
  "let me research the best practices for this",
  "what's the trade-off between these options",
];

const convergingTexts = [
  "this fix works, I'm satisfied with it",
  "ok implement it that way",
  "good, that solves the problem",
  "approved, go ahead and merge",
  "that's correct, ship it",
  "yes, that handles all the edge cases",
  "looks good to me",
  "confirmed, that approach works",
  "done, moving on",
  "excellent, this resolves the issue",
  "the tests pass, we're good",
  "this is the right solution",
  "go ahead with implementation",
  "yes, proceed with that fix",
  "accept this solution",
];

const qaTexts = [
  "answer a specific question",
  "can you review this code",
  "what does this function do",
  "is this the right pattern to use",
  "explain this error to me",
];

const exploringActions = ["observe", "explore", "defer"];
const convergingActions = ["act", "commit"];
const actions = [...exploringActions, ...convergingActions, "change"];

function generateScenario(iteration, rng) {
  const scenarioType = iteration % 3;
  const turns = [];

  if (scenarioType === 0) {
    const exploreLen = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < exploreLen; i++) {
      turns.push({
        text: exploringTexts[Math.floor(rng() * exploringTexts.length)],
        action: exploringActions[Math.floor(rng() * exploringActions.length)],
        explorePhase: true,
      });
    }
    const convergeLen = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < convergeLen; i++) {
      turns.push({
        text: convergingTexts[Math.floor(rng() * convergingTexts.length)],
        action: convergingActions[Math.floor(rng() * convergingActions.length)],
        explorePhase: false,
      });
    }
  } else if (scenarioType === 1) {
    for (let i = 0; i < 10; i++) {
      turns.push({
        text: i % 2 === 0 ? exploringTexts[Math.floor(rng() * exploringTexts.length)] : qaTexts[Math.floor(rng() * qaTexts.length)],
        action: sample(actions.filter(a => a !== "change"), rng),
        explorePhase: i < 7,
      });
    }
  } else {
    const pivotTurn = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < pivotTurn; i++) {
      turns.push({
        text: exploringTexts[Math.floor(rng() * exploringTexts.length)],
        action: sample(exploringActions, rng),
        explorePhase: true,
      });
    }
    turns.push({
      text: "actually let's change direction entirely",
      action: "change",
      explorePhase: true,
    });
    for (let i = 0; i < 3; i++) {
      turns.push({
        text: convergingTexts[Math.floor(rng() * convergingTexts.length)],
        action: sample(convergingActions, rng),
        explorePhase: false,
      });
    }
  }
  return turns;
}

const TIER_PROFILES = {
  cheap:  { entropy: [0.5, 0.4], uncertainty: [0.3, 0.4], instr: { exp: [0.3, 0.3], con: [0.5, 0.3] }, rep: [0.1, 0.3] },
  medium: { entropy: [0.35, 0.35], uncertainty: [0.2, 0.3], instr: { exp: [0.4, 0.3], con: [0.65, 0.25] }, rep: [0.07, 0.2] },
  brain:  { entropy: [0.2, 0.3], uncertainty: [0.1, 0.2], instr: { exp: [0.5, 0.3], con: [0.8, 0.2] }, rep: [0.05, 0.1] },
};

function simulateFeatures(text, explorePhase, tier, rng) {
  const p = TIER_PROFILES[tier] || TIER_PROFILES.cheap;
  const entropy = p.entropy[0] + rng() * p.entropy[1];
  const uncertainty = p.uncertainty[0] + rng() * p.uncertainty[1];
  const instr = explorePhase ? p.instr.exp : p.instr.con;
  const instructionDensity = instr[0] + rng() * instr[1];
  const repetition = explorePhase ? p.rep[0] + rng() * p.rep[1] : 0.0;

  return {
    ...ResolutionTracker.extractFeatures(text),
    instruction_density: instructionDensity,
    repetition: repetition,
    entropy,
    uncertainty,
  };
}

const EMBEDDING_PROFILES = {
  cheap:  { exp: [0.9, 0.7, 0.3, 0.5, 0.2], con: [0.2, 0.1, 0.9, 0.8, 0.3] },
  medium: { exp: [0.75, 0.6, 0.5, 0.55, 0.25], con: [0.2, 0.1, 0.9, 0.85, 0.45] },
  brain:  { exp: [0.6, 0.5, 0.4, 0.5, 0.3], con: [0.2, 0.1, 0.9, 0.8, 0.6] },
};

function makeEmbedding(phase, tier, rng) {
  const p = EMBEDDING_PROFILES[tier] || EMBEDDING_PROFILES.cheap;
  const base = phase ? p.exp : p.con;
  return base.map(v => v + gaussian(rng, 0, 0.05));
}

// ========================
// EXPERIMENT DEFINITIONS
// ========================
//
// Baseline:  no intervention. Standard isExploring (contradiction > 0.2).
//            Tier is always "cheap" (simulates a user locked to budget mode).
//
// Shift:     when EXPLORING >=3 turns, force brain tier.
//            Tier flips from cheap to brain. isExploring unchanged (0.2).
//            Brain tier produces better features (lower entropy, etc).
//
// Compound:  when EXPLORING >=3 turns AND tier is cheap -> tighten isExploring to 0.1.
//            When EXPLORING >=3 turns AND tier is brain -> already covered by Shift.
//            Tier stays cheap (no model upgrade available).
//            Tightened threshold forces exit from EXPLORING algorithmically.
// ========================

function run(experiment) {
  const results = [];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const scenario = generateScenario(iter, mulberry32(SEED + iter));
    const tracker = new ResolutionTracker(experiment, 10);
    const session = { regimes: [], resolutions: [], momentums: [], tiers: [], tightened: false };

    let consecutiveExploring = 0;

    for (let i = 0; i < scenario.length && i < MAX_TURNS; i++) {
      const turn = scenario[i];
      const rngLocal = mulberry32(SEED + iter + i + 999);

      const currentRegime = session.regimes.length > 0
        ? session.regimes[session.regimes.length - 1]
        : "INIT";

      let tier;
      if (experiment === "baseline") {
        tier = "cheap";
      } else if (experiment === "shift-medium") {
        tier = (currentRegime === "EXPLORING" && consecutiveExploring >= 3) ? "medium" : "cheap";
      } else if (experiment === "shift-brain") {
        tier = (currentRegime === "EXPLORING" && consecutiveExploring >= 3) ? "brain" : "cheap";
      } else if (experiment === "tighten") {
        tier = "cheap";
        if (currentRegime === "EXPLORING" && consecutiveExploring >= 3) {
          monkeyPatchIsExploring(tracker, 0.1);
          session.tightened = true;
        }
      }

      const features = simulateFeatures(turn.text, turn.explorePhase, tier, rngLocal);
      const embedding = makeEmbedding(turn.explorePhase, tier, rngLocal);

      const state = tracker.update(turn.text, features, turn.action, features.entropy, features.uncertainty, embedding);

      if (state.sub_regime === "EXPLORING") {
        consecutiveExploring++;
      } else {
        consecutiveExploring = 0;
      }

      session.regimes.push(state.sub_regime);
      session.resolutions.push(state.resolution);
      session.momentums.push(state.momentum);
      session.tiers.push(tier);
    }

    results.push(session);
  }
  return results;
}

function monkeyPatchIsExploring(tracker, threshold) {
  tracker.isExploring = function(contradiction, entropyTrend, _actionConsistency) {
    return (this.history && this.history.length >= 4)
      ? contradiction > threshold || entropyTrend > 0.005
      : contradiction > 0.2 || entropyTrend > 0.005;
  };
}

function regimeFinalDist(results) {
  const dist = {};
  for (const r of results) {
    const last = r.regimes[r.regimes.length - 1];
    dist[last] = (dist[last] || 0) + 1;
  }
  return dist;
}

function convergenceRate(results) {
  return results.filter(r => r.resolutions.some(s => s === "solved" || s === "converging")).length;
}

function avgExploringTurns(results) {
  return results.reduce((a, r) => a + r.regimes.filter(s => s === "EXPLORING").length, 0) / results.length;
}

function avgTurnsToConverge(results) {
  const turns = [];
  for (const r of results) {
    const idx = r.resolutions.findIndex(s => s === "solved" || s === "converging");
    if (idx >= 0) turns.push(idx + 1);
  }
  return turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : null;
}

function avgMomentum(results) {
  return results.reduce((a, r) => a + r.momentums.reduce((s, m) => s + m, 0) / r.momentums.length, 0) / results.length;
}

function tierDist(results) {
  const tiers = {};
  for (const r of results) for (const t of r.tiers) tiers[t] = (tiers[t] || 0) + 1;
  return tiers;
}

// ====== RUN ======
const baselineResults = run("baseline");
const shiftMediumResults = run("shift-medium");
const shiftBrainResults = run("shift-brain");
const tightenResults = run("tighten");

function report(label, results) {
  return {
    conv: convergenceRate(results),
    exp: avgExploringTurns(results),
    turn: avgTurnsToConverge(results),
    mom: avgMomentum(results),
    dist: regimeFinalDist(results),
    tiers: tierDist(results),
    tightened: results.filter(r => r.tightened).length,
  };
}

const scenarioTypes = ["explore->converge", "oscillating", "pivot->converge"];
console.log("=== A/B CONVERGENCE EXPERIMENT v3 ===");
console.log(`Samples: ${ITERATIONS} | Max turns: ${MAX_TURNS} | Scenario mix: ${scenarioTypes.join(", ")}\n`);

console.log("── Methodology ──");
console.log("Baseline:       tier=cheap always, isExploring=0.2 (no intervention)");
console.log("Shift-medium:   cheap -> medium when EXPLORING >=3 (your proposal)");
console.log("Shift-brain:    cheap -> brain  when EXPLORING >=3 (for reference)");
console.log("Tighten:        cheap always, isExploring 0.2 -> 0.1 when EXPLORING >=3\n");

const b = report("baseline", baselineResults);
const sm = report("shift-medium", shiftMediumResults);
const sb = report("shift-brain", shiftBrainResults);
const t = report("tighten", tightenResults);

console.log("── Tier Profiles ──");
console.log("cheap:  entropy=[0.5,0.9], uncertainty=[0.3,0.7], instr={exp:[0.3,0.6], con:[0.5,0.8]}");
console.log("medium: entropy=[0.35,0.7], uncertainty=[0.2,0.5], instr={exp:[0.4,0.7], con:[0.65,0.9]}");
console.log("brain:  entropy=[0.2,0.5], uncertainty=[0.1,0.3], instr={exp:[0.5,0.8], con:[0.8,1.0]}\n");

function fmtDist(dist) {
  const out = {};
  for (const r of ["EXPLORING", "CONVERGING", "CLOSED", "REFINING", "DIVERGENT", "LOOPING", "INIT"]) {
    if (dist[r]) out[r] = (dist[r]/ITERATIONS*100).toFixed(1) + "%";
  }
  return JSON.stringify(out);
}

console.log("── Final Regime Distribution (last turn) ──");
console.log(`Baseline:       ${fmtDist(b.dist)}`);
console.log(`Shift-medium:   ${fmtDist(sm.dist)}`);
console.log(`Shift-brain:    ${fmtDist(sb.dist)}`);
console.log(`Tighten:        ${fmtDist(t.dist)}`);

function fmt(t) { return t !== null ? t.toFixed(2) : "N/A"; }

console.log("\n── KPI Comparison ──");
console.log("Metric                          Baseline     Shift-med    Shift-brain  Tighten");
console.log("────────────────────────────────────────────────────────────────────────────");
console.log(`Convergence rate                ${(b.conv/ITERATIONS*100).toFixed(1)}%        ${(sm.conv/ITERATIONS*100).toFixed(1)}%        ${(sb.conv/ITERATIONS*100).toFixed(1)}%        ${(t.conv/ITERATIONS*100).toFixed(1)}%`);
console.log(`Avg exploring turns             ${b.exp.toFixed(2)}        ${sm.exp.toFixed(2)}        ${sb.exp.toFixed(2)}        ${t.exp.toFixed(2)}`);
console.log(`Avg turns to converge           ${fmt(b.turn)}        ${fmt(sm.turn)}        ${fmt(sb.turn)}        ${fmt(t.turn)}`);
console.log(`Avg momentum                    ${b.mom.toFixed(4)}    ${sm.mom.toFixed(4)}    ${sb.mom.toFixed(4)}    ${t.mom.toFixed(4)}`);
console.log(`Escaped exploring (final)       ${((ITERATIONS-(b.dist.EXPLORING||0))/ITERATIONS*100).toFixed(1)}%       ${((ITERATIONS-(sm.dist.EXPLORING||0))/ITERATIONS*100).toFixed(1)}%       ${((ITERATIONS-(sb.dist.EXPLORING||0))/ITERATIONS*100).toFixed(1)}%       ${((ITERATIONS-(t.dist.EXPLORING||0))/ITERATIONS*100).toFixed(1)}%`);

console.log("\n── Tier Usage ──");
console.log("Baseline:     ", JSON.stringify(b.tiers));
console.log("Shift-medium: ", JSON.stringify(sm.tiers));
console.log("Shift-brain:  ", JSON.stringify(sb.tiers));
console.log("Tighten:      ", JSON.stringify(t.tiers));

console.log(`\nTighten: ${t.tightened}/${ITERATIONS} sessions triggered tighter threshold`);

console.log("\n── Verdict ──");
const convs = [
  ["Baseline", b.conv],
  ["Shift-medium", sm.conv],
  ["Shift-brain", sb.conv],
  ["Tighten", t.conv],
];
convs.sort((a, b) => b[1] - a[1]);
console.log("Ranked by convergence rate:");
for (const [name, rate] of convs) {
  console.log(`  ${name.padEnd(14)} ${(rate/ITERATIONS*100).toFixed(1)}%`);
}
