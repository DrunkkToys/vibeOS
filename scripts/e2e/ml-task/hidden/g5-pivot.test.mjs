// SPDX-License-Identifier: MIT
// The turn-4 requirement change: a maxBuffered cap enforced via dropPolicy, and a
// dropped counter on stats().
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createPipeline } from "../src/pipeline.mjs"

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../pipeline.config.json", import.meta.url)), "utf8"))

test("the config declares maxBuffered", () => {
  assert.equal(config.maxBuffered, 6)
  assert.equal(config.dropPolicy, "reject-oldest")
})

test("the pipeline never buffers more than maxBuffered, and counts drops", async () => {
  const shipped = []
  const pipe = createPipeline(async (batch) => { shipped.push(...batch) })
  for (let i = 0; i < 20; i++) pipe.push({ type: "e", at: i })

  const before = pipe.stats()
  assert.ok(typeof before.dropped === "number", "stats() must report dropped")
  assert.ok(before.dropped > 0, "20 pushes against maxBuffered 6 must drop events")

  await pipe.drain()
  assert.ok(shipped.length <= config.maxBuffered, `flushed ${shipped.length} events, cap is ${config.maxBuffered}`)
  const ats = shipped.map((e) => e.at)
  assert.ok(Math.min(...ats) > 0, "reject-oldest must drop the oldest events, not the newest")
})
