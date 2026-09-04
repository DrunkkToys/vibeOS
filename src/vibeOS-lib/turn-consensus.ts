// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The vote the benchmark actually measures.
//
// adaptive-router.ts plans a vote and model-vote.ts runs one, but tool-execute.ts
// only reaches them inside the Task-delegation branch. Live turns measured in the
// A/B rig call read, bash, edit and write -- never task -- so that branch never
// opens and the vote never runs. The chain experiment's 107.9% arm votes on the
// answer to the user's question at the top of the turn, so that is where this
// runs: several independent models answer the prompt, and when a majority
// converges their answer is handed to the executing model as a checked
// reference. A split is reported as a split rather than hidden.
import { planForDifficulty, type AdaptiveSlot } from "./adaptive-router.js"
import { computeDifficulty } from "./ml-router.js"

export const CONSENSUS_MARKER = "[vibe-consensus]"

// OpenCode hands messages.transform rows shaped { info: { role, ... }, parts },
// not { role, parts }. Reading m.role found undefined on every row, so every
// turn scored a zero-length prompt and skipped the vote as "too short". Both
// shapes are accepted: the flat one is what the plugin's own tests and older
// hosts produce.
export function latestUserPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return ""
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; info?: { role?: unknown }; parts?: unknown }
    if (!m || typeof m !== "object") continue
    const role = m.info && typeof m.info === "object" ? m.info.role : m.role
    if (role !== "user") continue
    if (!Array.isArray(m.parts)) continue
    const text = m.parts
      .filter((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "text"
        && typeof (p as { text?: unknown }).text === "string"
        && !(p as { synthetic?: unknown }).synthetic)
      .map((p) => (p as { text: string }).text)
      .join("\n")
      .trim()
    if (text.length > 0) return text
  }
  return ""
}

// A vote is worth its latency only where the turn has somewhere to escalate to
// and the prompt is substantial enough for models to disagree about.
export const MIN_PROMPT_CHARS = 40

export interface ConsensusPlan { wantsVote: boolean; samples: number; reason: string }

export function planTurnConsensus(prompt: unknown, envelope: unknown): ConsensusPlan {
  const text = String(prompt || "").trim()
  if (text.length < MIN_PROMPT_CHARS) return { wantsVote: false, samples: 0, reason: "prompt too short to vote on" }
  const env = (Array.isArray(envelope) ? envelope : []).filter((s) => typeof s === "string") as AdaptiveSlot[]
  if (env.length < 2) return { wantsVote: false, samples: 0, reason: "single-tier envelope has nowhere to escalate" }
  const plan = planForDifficulty(computeDifficulty(text).score, env)
  const first = plan.stages[0]
  if (!first || first.kind === "single") return { wantsVote: false, samples: 0, reason: `plan ${plan.kind} opens with a single call` }
  return { wantsVote: true, samples: first.samples, reason: `plan ${plan.kind} opens with ${first.kind} x${first.samples}` }
}

export function buildConsensusNote(answer: unknown, samples: number, agreement: number): string {
  const body = String(answer || "").trim()
  if (body.length === 0) return ""
  const pct = Math.round(Math.max(0, Math.min(1, Number(agreement) || 0)) * 100)
  return [
    CONSENSUS_MARKER,
    `${samples} independent models were asked this question separately and ${pct}% of them converged on the answer below.`,
    "Treat it as a checked starting point, not as truth: it was produced without reading this repository, so verify every file path, symbol and claim against the actual code before you act on it. Where it is wrong, say so and proceed on the evidence.",
    "",
    body,
  ].join("\n")
}

export function buildContestedNote(samples: number, agreement: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, Number(agreement) || 0)) * 100)
  return [
    CONSENSUS_MARKER,
    `${samples} independent models were asked this question separately and did not agree (strongest answer held ${pct}%).`,
    "A split is a signal that the question is genuinely hard or underspecified. Do not answer from the first plausible reading: gather evidence from the code before committing to a diagnosis, and state explicitly what you verified.",
  ].join("\n")
}
