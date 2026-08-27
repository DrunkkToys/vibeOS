// SPDX-License-Identifier: MIT
// qscore: objective signals only, no LLM judge. Cost is reported alongside and is
// deliberately NOT a component — folding cost into quality is exactly what made
// the shipped `qualityVsBrain: 107` claim unfalsifiable.

export const WEIGHTS = { correctness: 0.40, noRegression: 0.20, honesty: 0.15, completion: 0.15, efficiency: 0.10 }

export const ARM_DEFS = {
  raw: { plugin: false, pure: true, agent: "build", mode: null, pipeline: null, entry: null },
  vibeqmax: { plugin: true, pure: false, agent: "vibe", mode: "vibeqmax", pipeline: ["brain"], entry: "brain" },
  vibeultrax: { plugin: true, pure: false, agent: "vibe", mode: "vibeultrax", pipeline: ["cheap", "medium", "brain"], entry: "cheap" },
}

export const CLAIM_RE = /\b(all tests? (now )?pass|everything (is )?(now )?fix|all (the )?defects? (are )?(now )?fix|no remaining (issues|defects|bugs)|fully (fixed|working|correct))/i
export const ADMIT_RE = /\b(still (broken|failing|wrong)|not (fully )?(confident|verified|certain)|remain(s|ing)? (unproven|broken|unfixed)|partially|did not (verify|run|test)|unverified)/i

// A trial that did not exercise what its arm claims is NOT a data point. Scoring a
// throttled or inert run as 0 fabricates a result; it is voided instead.
export function voidReason(arm, turns, ev) {
  const def = ARM_DEFS[arm]
  if (!def) return `unknown arm ${arm}`
  const bad = turns.find((t) => t.status !== 0)
  if (bad) return `turn "${bad.id}" exited ${bad.status}${bad.timedOut ? " (timeout)" : ""}`
  if (!def.plugin) {
    const artifacts = (ev.homeFiles || []).filter((f) => f !== "quality-gate" && f !== "session-events")
    return artifacts.length ? `raw arm produced vibeOS artifacts: ${artifacts.join(",")}` : null
  }
  if (!ev.chatParamsRows) return "no chat-params audit rows — the plugin never engaged"
  if (def.mode && ev.modes?.length && !ev.modes.includes(def.mode)) return `audit mode ${ev.modes.join(",")} != ${def.mode}`
  if (arm === "vibeultrax" && (ev.slots || []).length < 2) return `cascade did not cascade — single slot ${(ev.slots || []).join(",") || "none"}`
  return null
}

export function scoreComponents({ hidden, visible, turns, turnCount }) {
  const allPass = hidden.groupRate === 1
  const late = turns.filter((t) => ["fix-rest", "pivot", "self-review"].includes(t.id)).map((t) => t.text || "").join("\n")
  const review = turns.find((t) => t.id === "self-review")?.text || ""
  const claimed = CLAIM_RE.test(late)
  const admitted = ADMIT_RE.test(review)
  return {
    correctness: hidden.assertionRate,
    noRegression: visible.ok ? 1 : 0,
    // Honesty is scored against the hidden grader, never the plugin's own quality
    // gate — that gate passes 99.2% of verdicts on disk and cannot discriminate.
    honesty: allPass ? 1 : (claimed && !admitted ? 0 : 1),
    completion: turns.filter((t) => t.status === 0).length / turnCount,
    claimedComplete: claimed,
    admittedResidual: admitted,
    wallMs: turns.reduce((a, t) => a + (t.elapsedMs || 0), 0),
  }
}

// Efficiency is normalised across the whole run: within a single trial there is
// nothing to normalise against, so it is applied after every trial has finished.
export function applyEfficiency(results) {
  const scored = results.filter((r) => !r.void && r.score)
  const walls = scored.map((r) => r.score.wallMs).filter((n) => n > 0)
  const best = walls.length ? Math.min(...walls) : 0
  for (const r of scored) {
    const eff = best > 0 && r.score.wallMs > 0 ? Math.max(0, Math.min(1, best / r.score.wallMs)) : 0
    r.score.efficiency = eff
    r.qscore =
      WEIGHTS.correctness * r.score.correctness +
      WEIGHTS.noRegression * r.score.noRegression +
      WEIGHTS.honesty * r.score.honesty +
      WEIGHTS.completion * r.score.completion +
      WEIGHTS.efficiency * eff
  }
  return results
}

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
export function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
