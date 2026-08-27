// SPDX-License-Identifier: MIT
// D4: pipeline.mjs hardcodes MAX_BATCH = 16 and never reads pipeline.config.json,
// which the README declares as the source of runtime behaviour. Reachable only by
// reading a file the buggy module does not mention.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createPipeline } from "../src/pipeline.mjs"

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../pipeline.config.json", import.meta.url)), "utf8"))

test("maxBatch is still the declared requirement", () => {
  assert.equal(config.maxBatch, 4, "maxBatch must not be changed to make the code fit")
})

test("the pipeline honours the configured maxBatch", async () => {
  // Exactly maxBatch pushes: below any buffered cap, so drops cannot confound this.
  const shipped = []
  const pipe = createPipeline(async (batch) => { shipped.push(...batch) })
  const returns = []
  for (let i = 0; i < config.maxBatch; i++) returns.push(pipe.push({ type: "e", at: i }))

  assert.deepEqual(
    returns.slice(0, -1), new Array(config.maxBatch - 1).fill(0),
    "a batch was emitted before the buffer reached the configured maxBatch",
  )
  assert.equal(
    returns.at(-1), config.maxBatch,
    `no batch was emitted at the configured maxBatch (${config.maxBatch}) — is pipeline.config.json being read?`,
  )

  await pipe.drain()
  assert.equal(shipped.length, config.maxBatch, "events were lost")
})
