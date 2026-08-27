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
