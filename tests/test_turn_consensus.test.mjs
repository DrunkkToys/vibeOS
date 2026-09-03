// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  latestUserPrompt,
  planTurnConsensus,
  buildConsensusNote,
  buildContestedNote,
  CONSENSUS_MARKER,
  MIN_PROMPT_CHARS,
} from "../src/vibeOS-lib/turn-consensus.js"

const LONG = "diagnose why the batching helper drops the final chunk when the queue is flushed early"
const FULL = ["cheap", "medium", "brain"]

const userMsg = (text, extra = {}) => ({ role: "user", parts: [{ type: "text", text, ...extra }] })

test("the prompt read is the user's own text, not an injected directive", () => {
  const messages = [
    userMsg("the original question about the batching helper and its dropped chunk"),
    { role: "assistant", parts: [{ type: "text", text: "some answer" }] },
  ]
  assert.equal(latestUserPrompt(messages), "the original question about the batching helper and its dropped chunk")
})

test("a synthetic part injected by the plugin is not mistaken for the user's prompt", () => {
  const messages = [userMsg("real question here", {}), userMsg("[vibe-directive] do a thing", { synthetic: true })]
  assert.equal(latestUserPrompt(messages), "real question here",
    "voting on our own injected text would ask the models to answer the plugin")
})

test("the latest user turn wins over earlier ones", () => {
  const messages = [userMsg("first question"), { role: "assistant", parts: [] }, userMsg("second question")]
  assert.equal(latestUserPrompt(messages), "second question")
})

test("no user message yields no prompt", () => {
  assert.equal(latestUserPrompt([{ role: "assistant", parts: [{ type: "text", text: "hi" }] }]), "")
  assert.equal(latestUserPrompt(null), "")
  assert.equal(latestUserPrompt([]), "")
})

test("a substantial prompt in a three-tier envelope votes", () => {
  const plan = planTurnConsensus(LONG, FULL)
  assert.equal(plan.wantsVote, true, plan.reason)
  assert.ok(plan.samples >= 3, `a majority needs three voters, got ${plan.samples}`)
})

test("a one-line prompt is not worth four model calls", () => {
  const plan = planTurnConsensus("ls", FULL)
  assert.equal(plan.wantsVote, false)
  assert.ok(plan.reason.includes("short"))
})

test("the length floor is the documented one", () => {
  assert.equal(planTurnConsensus("x".repeat(MIN_PROMPT_CHARS - 1), FULL).wantsVote, false)
  assert.equal(planTurnConsensus("x".repeat(MIN_PROMPT_CHARS), FULL).wantsVote, true)
})

test("a brain-only envelope never votes: there is nowhere to escalate", () => {
  assert.equal(planTurnConsensus(LONG, ["brain"]).wantsVote, false)
  assert.equal(planTurnConsensus(LONG, []).wantsVote, false)
  assert.equal(planTurnConsensus(LONG, null).wantsVote, false)
})

test("an agreed answer is handed over as a reference, not as truth", () => {
  const note = buildConsensusNote("the flush path ignores the tail buffer", 4, 0.75)
  assert.ok(note.startsWith(CONSENSUS_MARKER))
  assert.ok(note.includes("the flush path ignores the tail buffer"))
  assert.ok(note.includes("75%"))
  assert.ok(/verify/i.test(note), "an unverified answer presented as fact is worse than no answer")
  assert.ok(/without reading this repository/i.test(note))
})

test("an empty agreed answer produces no note at all", () => {
  assert.equal(buildConsensusNote("", 4, 1), "")
  assert.equal(buildConsensusNote(null, 4, 1), "")
  assert.equal(buildConsensusNote("   ", 4, 1), "")
})

test("a split is reported as a split", () => {
  const note = buildContestedNote(4, 0.5)
  assert.ok(note.startsWith(CONSENSUS_MARKER))
  assert.ok(note.includes("did not agree"))
  assert.ok(note.includes("50%"))
  assert.ok(!/converged/i.test(note), "a split must not read like agreement")
})

test("agreement outside 0..1 is clamped rather than printed raw", () => {
  assert.ok(buildConsensusNote("a", 3, 4.2).includes("100%"))
  assert.ok(buildConsensusNote("a", 3, -1).includes("0%"))
  assert.ok(buildContestedNote(3, NaN).includes("0%"))
})
