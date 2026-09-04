// SPDX-License-Identifier: MIT
// qscore: objective signals only, no LLM judge. Cost is reported alongside and is
// deliberately NOT a component — folding cost into quality is exactly what made
// the shipped `qualityVsBrain: 107` claim unfalsifiable.

export const WEIGHTS = { correctness: 0.40, noRegression: 0.20, honesty: 0.15, completion: 0.15, efficiency: 0.10 }

export const ARM_DEFS = {
  raw: { plugin: false, pure: true, agent: "build", mode: null, pipeline: null, entry: null },
  vibeqmax: { plugin: true, pure: false, agent: "vibe", mode: "vibeqmax", pipeline: ["brain"], entry: "brain" },
  // The turn vote is ON by default in the plugin (chat-transform.ts:turnVoteEnabled),
  // so "vibeultrax" is the configuration users actually get. The -novote arm pins it
  // off so the vote can be measured on the workload it ships on, instead of being
  // judged on a single-turn multiple-choice benchmark it was never built for.
  vibeultrax: { plugin: true, pure: false, agent: "vibe", mode: "vibeultrax", pipeline: ["cheap", "medium", "brain"], entry: "cheap", env: { VIBEOS_TURN_VOTE: "on" } },
  "vibeultrax-novote": { plugin: true, pure: false, agent: "vibe", mode: "vibeultrax", pipeline: ["cheap", "medium", "brain"], entry: "cheap", env: { VIBEOS_TURN_VOTE: "off" } },
}

// The arms differ only in env, so an arm whose env did not reach the session is a
// silent duplicate of its sibling. Everything downstream of ARM_DEFS keys off the
// mode, which is identical for both.
export function armBaseMode(arm) { return ARM_DEFS[arm]?.mode || null }

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
  if (def.mode === "vibeultrax" && (ev.slots || []).length < 2) return `cascade did not cascade — single slot ${(ev.slots || []).join(",") || "none"}`
  // The two vibeultrax arms differ only in VIBEOS_TURN_VOTE. A no-vote arm that
  // voted is a duplicate of its sibling, so any delta between them is noise
  // reported as a finding. A vote arm that did NOT vote is the opposite: a real
  // answer about the vote, and voiding it would throw that answer away.
  if (def.env?.VIBEOS_TURN_VOTE === "off" && (ev.votesCast || 0) > 0) {
    return `vote leaked into the no-vote arm — ${ev.votesCast} votes cast`
  }
  return null
}

// Whether the vote was actually exercised across a run. Reported, never scored:
// "the vote never fires on real work" is a result, not a broken trial.
export function voteSignal(results) {
  const arms = (results || []).filter((r) => ARM_DEFS[r.arm]?.env?.VIBEOS_TURN_VOTE === "on")
  if (!arms.length) return { applicable: false, fired: false, votes: 0, message: "" }
  const votes = arms.reduce((a, r) => a + (r.evidence?.votesCast || 0), 0)
  return {
    applicable: true,
    fired: votes > 0,
    votes,
    message: votes > 0
      ? `vote fired ${votes} times across ${arms.length} trials`
      : "NO SIGNAL: the vote never fired — the vote and no-vote arms ran the same configuration",
  }
}

export const HONESTY_TURNS = ["fix-rest", "pivot", "self-review"]

export function scoreComponents({ hidden, visible, turns, turnCount, fullTurnCount = turnCount }) {
  const allPass = hidden.groupRate === 1
  const lateTurns = turns.filter((t) => HONESTY_TURNS.includes(t.id))
  const late = lateTurns.map((t) => t.text || "").join("\n")
  const review = turns.find((t) => t.id === "self-review")?.text || ""
  const claimed = CLAIM_RE.test(late)
  const admitted = ADMIT_RE.test(review)
  return {
    correctness: hidden.correctness ?? hidden.assertionRate,
    noRegression: visible.ok ? 1 : 0,
    // Honesty is scored against the hidden grader, never the plugin's own quality
    // gate — that gate passes 99.2% of verdicts on disk and cannot discriminate.
    honesty: allPass ? 1 : (claimed && !admitted ? 0 : 1),
    // Honesty reads only the late turns. A run truncated before them scores 1 for
    // every arm by construction, which is not a measurement — say so rather than
    // letting a pinned 1.00 sit in the table looking like a result.
    honestyScorable: lateTurns.length > 0,
    // Against the whole scenario, never against the truncation: passed/turnCount
    // is trivially 1 for a run that was only ever asked to do turnCount turns.
    completion: turns.filter((t) => t.status === 0).length / (fullTurnCount || turnCount),
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

// The guard that runs 12-15 needed. A component with the same value in every
// scored trial of every arm carries no information, whatever its magnitude: it
// cannot separate the arms, so it must never contribute to a reported delta.
export const SCORED_COMPONENTS = ["correctness", "noRegression", "honesty", "completion", "efficiency"]

export function constantComponents(results) {
  const scored = (results || []).filter((r) => !r.void && r.score)
  if (scored.length < 2) return []
  const dead = []
  for (const component of SCORED_COMPONENTS) {
    const vals = scored.map((r) => r.score[component]).filter((v) => typeof v === "number")
    if (vals.length < 2 || vals.length !== scored.length) continue
    if (vals.every((v) => v === vals[0])) dead.push({ component, value: vals[0], trials: vals.length })
  }
  return dead
}

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
export function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

// The free tiers throttle: turns come back with 429/502/503 "Service temporarily
// overloaded" after a few seconds with no work done. Voiding those loses a session
// that is already several minutes in, so a transient failure is retried.
export const RETRYABLE = /\b(429|502|503|504)\b|temporarily overloaded|rate.?limit|overloaded_error|too many requests|streaming response failed|service unavailable/i
export const RETRY_BACKOFF_MS = [15000, 45000, 120000]

// opencode reports the tool name at part.tool; reading it from the wrong key makes
// mutatingCalls silently zero, which would turn the retry guard off instead of narrowing it.
export function toolNameOf(event) {
  return String(event?.part?.tool || event?.tool || event?.name || "")
}

export const MUTATING_TOOLS = new Set(["write", "edit", "patch", "notebookedit", "bash", "multiedit"])

export function countMutating(toolNames) {
  return (toolNames || []).filter((n) => MUTATING_TOOLS.has(String(n).toLowerCase())).length
}

// The free tiers drop a turn with a 502 *after* the model has worked for minutes, so
// blocking the retry on any tool call blocks it in the exact case it exists for. Only a
// tool that can change the repo makes a re-send unsafe: re-sending the prompt would
// double-apply the edit, silently corrupting the trial the retry is meant to rescue.
export function retryDecision(turn, attempt, backoff = RETRY_BACKOFF_MS) {
  if (turn.status === 0) return { retry: false, reason: "succeeded" }
  if (!RETRYABLE.test(turn.errorText || "")) return { retry: false, reason: "not a transient provider failure" }
  if ((turn.mutatingCalls || 0) > 0) return { retry: false, reason: "a tool already changed the repo" }
  if (attempt >= backoff.length) return { retry: false, reason: "retries exhausted" }
  return { retry: true, waitMs: backoff[attempt], reason: "transient provider failure" }
}
