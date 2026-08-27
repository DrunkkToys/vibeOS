// SPDX-License-Identifier: MIT
// D1: the batcher must emit a batch the moment the buffer reaches maxBatch, not
// one item later. Only observable when the item count is a multiple of maxBatch.
import test from "node:test"
import assert from "node:assert/strict"
import { Batcher } from "../src/batcher.mjs"

test("emits at exactly maxBatch", () => {
  const b = new Batcher(4)
  const batches = []
  for (let i = 0; i < 12; i++) {
    const out = b.push({ at: i })
    if (out) batches.push(out)
  }
  assert.equal(b.drain(), null, "nothing may be left buffered after 12 items at maxBatch 4")
  assert.equal(batches.length, 3, "12 items at maxBatch 4 must emit 3 batches")
  for (const batch of batches) assert.equal(batch.length, 4, "every batch must hold exactly maxBatch items")
})

test("no item is lost or duplicated", () => {
  const b = new Batcher(3)
  const seen = []
  for (let i = 0; i < 10; i++) {
    const out = b.push({ at: i })
    if (out) seen.push(...out)
  }
  const tail = b.drain()
  if (tail) seen.push(...tail)
  assert.deepEqual(seen.map((e) => e.at), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})
