// Adaptive routing strategy for vibeOS trinity routing.
// Pure TypeScript — no external dependencies, no I/O.
//
// This encodes the strategy the VibeBrainUltra chain experiment measured as the
// only one that Pareto-dominates the raw brain baseline:
//
//   Adaptive (easy = vote, hard = pipeline)   107.9% of brain quality
//   Cascade  (weak -> strong)                  83.8% of brain quality
//
// The difference is not the model set, it is the primitive. Cascade picks ONE
// model from a difficulty threshold and lives with its answer. Adaptive samples
// several cheap answers and only spends a stronger tier when those answers
// disagree — the escalation is driven by evidence, not by a guess made before
// any answer exists.
//
// The simulation resolved a vote against an oracle (it knew the true answer).
// A live router has no oracle, so the observable proxy is agreement: when a
// majority of independent samples land on the same answer, take it; otherwise
// escalate. Agreement is what makes self-consistency work in practice, and it
// is strictly more information than the prompt alone carries.

export type AdaptiveSlot = "cheap" | "medium" | "brain"
export type StageKind = "vote" | "debate" | "single"

export interface AdaptiveStage {
  slot: AdaptiveSlot
  kind: StageKind
  samples: number
  agreementThreshold: number
}

export interface AdaptivePlan {
  kind: "vote" | "pipeline"
  slot?: AdaptiveSlot
  samples?: number
  agreementThreshold?: number
  stages: AdaptiveStage[]
  reason: string
}

// The easy/hard split the chain experiment used for the winning strategy.
export const ADAPTIVE_VOTE_CEILING = 0.40

// Stage widths, mirroring fullPipeline(): vote(3) -> debate(2) -> brain(1).
const VOTE_SAMPLES = 4
const PIPELINE_VOTE_SAMPLES = 3
const PIPELINE_DEBATE_SAMPLES = 2
const DEFAULT_AGREEMENT = 0.5

const SLOT_RANK: Record<string, number> = { cheap: 0, medium: 1, brain: 2 }

function normalizeEnvelope(envelope: unknown): AdaptiveSlot[] {
  if (!Array.isArray(envelope)) return []
  const seen = new Set<AdaptiveSlot>()
  for (const raw of envelope) {
    const slot = String(raw || "").trim().toLowerCase()
    if (slot === "cheap" || slot === "medium" || slot === "brain") seen.add(slot)
  }
  return [...seen].sort((a, b) => SLOT_RANK[a] - SLOT_RANK[b])
}

function stage(slot: AdaptiveSlot, kind: StageKind, samples: number): AdaptiveStage {
  return { slot, kind, samples, agreementThreshold: DEFAULT_AGREEMENT }
}

// A vote costs N calls at one tier. That only buys anything when the tier is
// cheap enough that N of them still undercut one call at a stronger tier, so a
// single-rung envelope — or one whose floor is the brain — degrades to a plain
// single call rather than paying N times for the most expensive model.
function canVoteAt(slot: AdaptiveSlot, envelope: AdaptiveSlot[]): boolean {
  if (slot === "brain") return false
  return envelope.length > 1
}

export function planForDifficulty(
  score: number,
  envelope: unknown,
  opts?: { voteCeiling?: number },
): AdaptivePlan {
  const rungs = normalizeEnvelope(envelope)
  const ceiling = Number.isFinite(opts?.voteCeiling as number)
    ? Number(opts?.voteCeiling)
    : ADAPTIVE_VOTE_CEILING
  const d = Number.isFinite(score) ? Number(score) : 1

  if (rungs.length === 0) {
    return {
      kind: "pipeline",
      stages: [stage("brain", "single", 1)],
      reason: `pipeline: empty envelope, single brain call (difficulty ${d.toFixed(2)})`,
    }
  }

  const floor = rungs[0]

  if (d <= ceiling && canVoteAt(floor, rungs)) {
    return {
      kind: "vote",
      slot: floor,
      samples: VOTE_SAMPLES,
      agreementThreshold: DEFAULT_AGREEMENT,
      stages: [stage(floor, "vote", VOTE_SAMPLES)],
      reason: `vote: ${VOTE_SAMPLES} samples on ${floor} (difficulty ${d.toFixed(2)} <= ${ceiling})`,
    }
  }

  // fullPipeline(): each rung the envelope actually offers, cheapest first, with
  // the sampling width the benchmark used at that position.
  const stages: AdaptiveStage[] = []
  for (let i = 0; i < rungs.length; i++) {
    const slot = rungs[i]
    const last = i === rungs.length - 1
    if (last || !canVoteAt(slot, rungs)) {
      stages.push(stage(slot, "single", 1))
      continue
    }
    if (i === 0) stages.push(stage(slot, "vote", PIPELINE_VOTE_SAMPLES))
    else stages.push(stage(slot, "debate", PIPELINE_DEBATE_SAMPLES))
  }

  return {
    kind: "pipeline",
    stages,
    reason: `pipeline: ${stages.map((s) => `${s.slot}/${s.kind}`).join(" -> ")} (difficulty ${d.toFixed(2)})`,
  }
}

function normalizeAnswer(answer: unknown): string {
  return String(answer ?? "").trim().replace(/\s+/g, " ")
}

export function agreementRatio(answers: unknown): number {
  if (!Array.isArray(answers) || answers.length === 0) return 0
  const counts = new Map<string, number>()
  let considered = 0
  for (const raw of answers) {
    const a = normalizeAnswer(raw)
    if (!a) continue
    considered++
    counts.set(a, (counts.get(a) || 0) + 1)
  }
  if (considered === 0) return 0
  let best = 0
  for (const n of counts.values()) if (n > best) best = n
  return best / considered
}

export interface VoteResult {
  agreed: boolean
  answer: string | null
  agreement: number
  samples: number
}

export function resolveVote(answers: unknown, threshold: number): VoteResult {
  const list = Array.isArray(answers) ? answers : []
  const counts = new Map<string, number>()
  let considered = 0
  for (const raw of list) {
    const a = normalizeAnswer(raw)
    if (!a) continue
    considered++
    counts.set(a, (counts.get(a) || 0) + 1)
  }
  if (considered === 0) return { agreed: false, answer: null, agreement: 0, samples: 0 }

  let best: string | null = null
  let bestCount = 0
  let tied = false
  for (const [answer, n] of counts) {
    if (n > bestCount) { best = answer; bestCount = n; tied = false }
    else if (n === bestCount) tied = true
  }

  const agreement = bestCount / considered
  const bar = Number.isFinite(threshold) ? Number(threshold) : DEFAULT_AGREEMENT
  // A tie is not a majority: two answers with equal support carry no verdict,
  // so the caller must escalate rather than pick the one that happened to sort
  // first. Only a strict plurality above the bar resolves.
  const agreed = !tied && agreement > bar

  return {
    agreed,
    answer: agreed ? best : null,
    agreement,
    samples: considered,
  }
}

// ── Carrying a vote to a model that only answers once ────────────────
//
// tool.execute.before can rewrite a delegated task, but it cannot issue extra
// tool calls, so the N samples of a vote cannot be N separate requests from
// here. They are instead N independent attempts inside the delegated turn, with
// the worker reporting how many of them agreed. That report is the escalation
// signal: a split vote is evidence the cheap tier is out of its depth, which is
// exactly the trigger the benchmark's pipeline escalates on.

export const VOTE_MARKER = "VIBE-VOTE:"

export function buildVotePrompt(prompt: string, samples: number): string {
  const base = String(prompt ?? "")
  const n = Number(samples)
  if (!Number.isFinite(n) || n < 2) return base
  const k = Math.min(Math.floor(n), 8)
  return [
    base,
    "",
    `Before answering, solve this ${k} separate times, independently. Do not let one`,
    "attempt look at another: start each from the original question, not from a",
    "previous attempt's conclusion.",
    "",
    "Then compare the attempts. Answer with whichever conclusion the majority of them",
    "reached. If they do not agree, say so plainly rather than picking one.",
    "",
    `End your reply with a single line: ${VOTE_MARKER} <agreeing>/${k}`,
    `For example ${VOTE_MARKER} ${k}/${k} if every attempt agreed.`,
  ].join("\n")
}

export interface VoteReport {
  reported: boolean
  agreed: boolean
  agreement: number
  samples: number
}

const NO_REPORT: VoteReport = { reported: false, agreed: false, agreement: 0, samples: 0 }

export function parseVoteReport(text: unknown): VoteReport {
  const s = typeof text === "string" ? text : ""
  if (!s) return NO_REPORT
  const marker = VOTE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matches = [...s.matchAll(new RegExp(`${marker}\\s*(\\d+)\\s*/\\s*(\\d+)`, "g"))]
  if (matches.length === 0) return NO_REPORT
  // Take the last report: the marker is specified as the final line, and a
  // worker that quotes the instruction before answering would otherwise be
  // parsed from its own example.
  const last = matches[matches.length - 1]
  const agreeing = Number(last[1])
  const total = Number(last[2])
  if (!Number.isFinite(agreeing) || !Number.isFinite(total)) return NO_REPORT
  if (total <= 0 || agreeing < 0 || agreeing > total) return NO_REPORT
  const agreement = agreeing / total
  return { reported: true, agreed: agreement > 0.5, agreement, samples: total }
}
