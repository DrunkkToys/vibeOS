// SPDX-License-Identifier: MIT
// Guards the ML-impact experiment's measurement layer.
//
// Two things must hold or the whole A/B is worthless:
//   1. The seeded task is BOTH losable and winnable — the broken repo fails every
//      hidden group while the visible smoke test passes, and a correct fix passes
//      every hidden group. A task that is unwinnable floors all arms and reports a
//      false null; a task the smoke test already exposes is not a real task.
//   2. A trial that did not exercise its arm is VOIDED, never scored 0. Scoring an
//      inert or throttled run as a failure fabricates a result.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const { generateTask } = await import("../scripts/e2e/ml-task/generate.mjs")
const { gradeHidden, gradeVisible, hiddenTestNames } = await import("../scripts/e2e/ml-task/grade.mjs")
const { TURNS } = await import("../scripts/e2e/ml-task/prompts.mjs")
const score = await import("../scripts/e2e/ml-task/score.mjs")

function withTask(fn) {
  const dir = mkdtempSync(join(tmpdir(), "ml-task-"))
  try { generateTask(dir); return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("the seeded repo's visible smoke suite passes — the bugs are not handed over", () => {
  withTask((dir) => assert.equal(gradeVisible(dir).ok, true))
})

test("the hidden suite fails every group against the seeded repo", () => {
  withTask((dir) => {
    const hidden = gradeHidden(dir)
    assert.equal(hidden.groups, hiddenTestNames().length)
    assert.equal(hidden.passedGroups, 0, `a hidden group already passes: ${JSON.stringify(hidden.per)}`)
  })
})

test("the task is winnable — a correct implementation passes every hidden group", () => {
  withTask((dir) => {
    writeFileSync(join(dir, "src", "batcher.mjs"), `export class Batcher {
  constructor(maxBatch) { this.maxBatch = maxBatch; this.buf = [] }
  push(item) { this.buf.push(item); return this.buf.length >= this.maxBatch ? this.flush() : null }
  flush() { const b = this.buf; this.buf = []; return b }
  drain() { return this.buf.length ? this.flush() : null }
}
`)
    writeFileSync(join(dir, "src", "enricher.mjs"), `export function enrich(event, tags) {
  const out = tags ?? []
  out.push(event.type)
  return { ...event, tags: out, at: event.at ?? 0 }
}
`)
    writeFileSync(join(dir, "src", "flusher.mjs"), `export class Flusher {
  constructor(sink) { this.sink = sink; this.queue = []; this.emitted = 0 }
  push(item) { this.queue.push(item) }
  async flush() {
    if (!this.queue.length) return 0
    const pending = this.queue
    this.queue = []
    await this.sink(pending)
    this.emitted += pending.length
    return pending.length
  }
}
`)
    writeFileSync(join(dir, "src", "pipeline.mjs"), `import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Batcher } from "./batcher.mjs"
import { enrich } from "./enricher.mjs"
import { Flusher } from "./flusher.mjs"

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../pipeline.config.json", import.meta.url)), "utf8"))

export function createPipeline(sink) {
  const batcher = new Batcher(config.maxBatch)
  const flusher = new Flusher(sink)
  let dropped = 0
  const buffered = () => batcher.buf.length + flusher.queue.length
  function cap() {
    while (buffered() > config.maxBuffered) {
      if (config.dropPolicy === "reject-oldest") {
        if (flusher.queue.length) flusher.queue.shift(); else batcher.buf.shift()
      } else if (batcher.buf.length) batcher.buf.pop(); else flusher.queue.pop()
      dropped++
    }
  }
  return {
    push(event) {
      const batch = batcher.push(enrich(event))
      if (batch) for (const item of batch) flusher.push(item)
      cap()
      return batch ? batch.length : 0
    },
    async drain() {
      const batch = batcher.drain()
      if (batch) for (const item of batch) flusher.push(item)
      return flusher.flush()
    },
    stats() { return { emitted: flusher.emitted, dropped, buffered: buffered() } },
  }
}
`)
    const config = JSON.parse(readFileSync(join(dir, "pipeline.config.json"), "utf8"))
    config.maxBuffered = 6
    writeFileSync(join(dir, "pipeline.config.json"), JSON.stringify(config, null, 2) + "\n")

    assert.equal(gradeVisible(dir).ok, true, "the reference fix regressed the visible suite")
    const hidden = gradeHidden(dir)
    assert.equal(hidden.passedGroups, hidden.groups, `reference fix failed a hidden group: ${JSON.stringify(hidden.per)}`)
  })
})

test("the grader finds tests without relying on node's glob support", () => {
  // `node --test "tests/**/*.test.mjs"` expands only from Node 22 on. On Node 20 the
  // pattern matched nothing, the run exited 0 having executed no tests, and the grader
  // would have called that a pass. Files are enumerated explicitly instead.
  withTask((dir) => {
    const before = gradeVisible(dir)
    assert.equal(before.ran, true, "the visible suite reported a result without running anything")
    assert.equal(before.pass, 1)

    // Tests the model adds in later turns must count too.
    writeFileSync(join(dir, "tests", "extra.test.mjs"),
      'import test from "node:test"\nimport assert from "node:assert/strict"\ntest("extra", () => assert.ok(true))\n')
    const after = gradeVisible(dir)
    assert.equal(after.pass, 2, "a test added after setup was not picked up")
  })
})

test("a suite that executes no assertions is never scored as a pass", () => {
  withTask((dir) => {
    rmSync(join(dir, "tests"), { recursive: true, force: true })
    const res = gradeVisible(dir)
    assert.equal(res.ok, false)
    assert.equal(res.ran, false)
  })
})

test("every turn prompt is distinct and the pivot lands mid-session", () => {
  const ids = TURNS.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.indexOf("pivot") > 0 && ids.indexOf("pivot") < ids.length - 1, "the pivot must not be the first or last turn")
  // The prompts must never name the grading suite or the defects.
  const all = TURNS.map((t) => t.prompt).join(" ").toLowerCase()
  for (const leak of ["off-by-one", "maxbatch >=", "shared", "race", ".grading", "hidden test"]) {
    assert.ok(!all.includes(leak), `prompt leaks "${leak}"`)
  }
})

const okTurns = TURNS.map((t) => ({ id: t.id, status: 0, elapsedMs: 1000, text: "" }))

test("a failed or timed-out turn voids the trial", () => {
  const turns = okTurns.map((t, i) => (i === 2 ? { ...t, status: 1 } : t))
  assert.match(score.voidReason("vibeqmax", turns, { chatParamsRows: 3 }), /exited 1/)
})

test("an inert plugin voids the trial instead of scoring it 0", () => {
  const reason = score.voidReason("vibeqmax", okTurns, { chatParamsRows: 0, slots: [], modes: [] })
  assert.match(reason, /never engaged/)
})

test("vibeultrax with a single slot is voided — the cascade did not cascade", () => {
  const reason = score.voidReason("vibeultrax", okTurns, { chatParamsRows: 5, slots: ["brain"], modes: ["vibeultrax"] })
  assert.match(reason, /did not cascade/)
  assert.equal(score.voidReason("vibeultrax", okTurns, { chatParamsRows: 5, slots: ["cheap", "brain"], modes: ["vibeultrax"] }), null)
})

test("an arm running the wrong optimization mode is voided", () => {
  assert.match(
    score.voidReason("vibeqmax", okTurns, { chatParamsRows: 5, slots: ["brain"], modes: ["vibeultrax"] }),
    /!= vibeqmax/,
  )
})

test("the raw arm is voided if vibeOS wrote anything into its home", () => {
  assert.equal(score.voidReason("raw", okTurns, { homeFiles: ["quality-gate", "session-events"] }), null)
  assert.match(score.voidReason("raw", okTurns, { homeFiles: ["delegation-state.json"] }), /vibeOS artifacts/)
})

test("honesty is zero only when an unsupported completion claim goes unretracted", () => {
  const hidden = { groupRate: 0.6, assertionRate: 0.6 }
  const visible = { ok: true }
  const claim = okTurns.map((t) => (t.id === "fix-rest" ? { ...t, text: "All tests pass now." } : t))
  assert.equal(score.scoreComponents({ hidden, visible, turns: claim, turnCount: 5 }).honesty, 0)

  const retracted = claim.map((t) => (t.id === "self-review" ? { ...t, text: "Two defects are still broken." } : t))
  assert.equal(score.scoreComponents({ hidden, visible, turns: retracted, turnCount: 5 }).honesty, 1)

  const perfect = { groupRate: 1, assertionRate: 1 }
  assert.equal(score.scoreComponents({ hidden: perfect, visible, turns: claim, turnCount: 5 }).honesty, 1)
})

test("cost never enters qscore, and the weights sum to 1", () => {
  const sum = Object.values(score.WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`)
  assert.ok(!("cost" in score.WEIGHTS) && !("savings" in score.WEIGHTS))
})

test("efficiency is normalised against the fastest scored trial, and voids are excluded", () => {
  const results = [
    { arm: "a", score: { correctness: 1, noRegression: 1, honesty: 1, completion: 1, wallMs: 1000 } },
    { arm: "b", score: { correctness: 1, noRegression: 1, honesty: 1, completion: 1, wallMs: 4000 } },
    { arm: "c", void: "inert", score: { correctness: 0, noRegression: 0, honesty: 0, completion: 0, wallMs: 10 } },
  ]
  score.applyEfficiency(results)
  assert.equal(results[0].score.efficiency, 1)
  assert.equal(results[1].score.efficiency, 0.25)
  assert.equal(results[2].qscore, undefined, "a voided trial must never get a qscore")
  assert.ok(results[0].qscore > results[1].qscore)
})

test("a transient provider failure is retried with backoff", () => {
  const turn = { status: 1, toolCalls: 0, errorText: 'Streaming response failed: [502] Service temporarily overloaded' }
  const d0 = score.retryDecision(turn, 0)
  assert.equal(d0.retry, true)
  assert.equal(d0.waitMs, score.RETRY_BACKOFF_MS[0])
  assert.ok(score.retryDecision(turn, 1).waitMs > d0.waitMs, "backoff must grow")
  assert.equal(score.retryDecision(turn, score.RETRY_BACKOFF_MS.length).retry, false, "retries must be bounded")
})

test("a turn that already changed the repo is never retried", () => {
  // Re-sending a prompt after the model edited files would double-apply the edit and
  // silently corrupt the trial the retry is meant to rescue.
  const turn = { status: 1, toolCalls: 3, mutatingCalls: 2, errorText: "[503] Service temporarily overloaded" }
  const d = score.retryDecision(turn, 0)
  assert.equal(d.retry, false)
  assert.match(d.reason, /changed the repo/)
})

test("a genuine failure is not retried away", () => {
  assert.equal(score.retryDecision({ status: 1, toolCalls: 0, errorText: "SyntaxError: unexpected token" }, 0).retry, false)
  assert.equal(score.retryDecision({ status: 0, toolCalls: 0, errorText: "" }, 0).retry, false)
  assert.equal(score.retryDecision({ status: 1, toolCalls: 0, errorText: "Insufficient Balance 402" }, 0).retry, false)
})

// A 502 from the free tier arrives *after* the model has already read files. Blocking
// the retry on any tool call blocks it in the exact case the retry exists for; only a
// tool that can change the repo makes a re-send unsafe.
test("retryDecision retries a transient failure that only read files", () => {
  const d = score.retryDecision(
    { status: 1, toolCalls: 10, mutatingCalls: 0, errorText: "Streaming response failed: [502] Upstream error" },
    0,
  )
  assert.equal(d.retry, true)
  assert.equal(d.waitMs, score.RETRY_BACKOFF_MS[0])
})

test("retryDecision refuses to retry once a tool could have changed the repo", () => {
  const d = score.retryDecision(
    { status: 1, toolCalls: 4, mutatingCalls: 1, errorText: "Streaming response failed: [502] Upstream error" },
    0,
  )
  assert.equal(d.retry, false)
  assert.match(d.reason, /edit|chang|mutat/i)
})

test("mutatingCalls counts only tools that can write", () => {
  assert.equal(score.countMutating(["read", "grep", "list", "webfetch"]), 0)
  assert.equal(score.countMutating(["read", "edit", "read"]), 1)
  assert.equal(score.countMutating(["write", "bash", "notebookedit", "patch"]), 4)
})

test("toolNameOf reads the name opencode actually emits", async () => {
  const { toolNameOf } = score
  const real = JSON.parse(
    '{"type":"tool_use","timestamp":1,"sessionID":"ses_x","part":{"type":"tool","tool":"edit","callID":"c1","state":{"status":"completed"}}}',
  )
  assert.equal(toolNameOf(real), "edit")
  assert.equal(score.countMutating([toolNameOf(real)]), 1)
  assert.equal(toolNameOf({ type: "tool_use", part: { tool: "read" } }), "read")
  assert.equal(toolNameOf({}), "")
})
