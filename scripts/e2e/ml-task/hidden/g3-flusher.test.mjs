// SPDX-License-Identifier: MIT
// D3: flush() clears the queue AFTER awaiting the sink, so anything pushed while
// the sink is in flight is silently dropped.
import test from "node:test"
import assert from "node:assert/strict"
import { Flusher } from "../src/flusher.mjs"

test("items pushed during an in-flight flush are not dropped", async () => {
  let release = null
  const gate = new Promise((r) => { release = r })
  const shipped = []
  const f = new Flusher(async (batch) => { shipped.push(...batch); await gate })

  f.push({ at: 0 })
  f.push({ at: 1 })
  const inFlight = f.flush()
  f.push({ at: 2 })
  release()
  await inFlight
  await f.flush()

  assert.deepEqual(shipped.map((e) => e.at).sort((x, y) => x - y), [0, 1, 2], "an event pushed mid-flush was lost")
})

test("flush on an empty queue is a no-op", async () => {
  let calls = 0
  const f = new Flusher(async () => { calls++ })
  assert.equal(await f.flush(), 0)
  assert.equal(calls, 0)
})
