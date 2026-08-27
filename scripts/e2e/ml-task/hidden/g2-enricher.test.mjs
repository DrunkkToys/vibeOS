// SPDX-License-Identifier: MIT
// D2: the default tags array is shared across calls, so the second call inherits
// the first call's tags. Only observable on the second call.
import test from "node:test"
import assert from "node:assert/strict"
import { enrich } from "../src/enricher.mjs"

test("independent calls do not share tag state", () => {
  const a = enrich({ type: "click" })
  const b = enrich({ type: "scroll" })
  assert.deepEqual(a.tags, ["click"])
  assert.deepEqual(b.tags, ["scroll"], "the second call inherited the first call's tags")
})

test("an explicitly passed array is still honoured", () => {
  const tags = ["seed"]
  const out = enrich({ type: "key" }, tags)
  assert.deepEqual(out.tags, ["seed", "key"])
})

test("repeated calls stay stable", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(enrich({ type: "t" + i }).tags.length, 1, `call ${i} leaked`)
  }
})
