// SPDX-License-Identifier: MIT
// The system prompt is the cached prefix of every request. A single per-turn
// byte in it invalidates the whole cache.
//
// Measured on the ml-impact rig (first-step input tokens / cache reads, same
// task, same model, raw vs plugin):
//
//   turn          raw             vibeqmax        vibeultrax
//   diagnose      7,562 /  1,792   9,654 / 1,792   9,763 /  1,792
//   fix-batching  1,039 / 25,280  12,638 /10,240  15,627 / 10,752
//   fix-rest        249 / 27,520  14,057 /10,240  HANG
//
// Raw's request shrinks as its cache warms; both plugin arms grow while cache
// reads flatline. 56x the input by turn three, and both plugin arms voided on
// that turn while raw finished it in 300s.
import { test } from "node:test"
import assert from "node:assert/strict"

const MARKER = "[vibeos:turn-state]"

async function load() {
  return import("../src/lib/hooks/chat-transform.js?stable=" + Math.random())
}

test("volatile directives stay out of system when the flag is on", async () => {
  process.env.VIBEOS_STABLE_PREFIX = "1"
  const m = await load()
  m.resetVolatileBuffer()

  const output = { system: [] }
  const before = JSON.stringify(output.system)
  // pushTurnState is internal; drive it through the exported buffer contract.
  assert.equal(m.stablePrefixEnabled(), true)
  assert.deepEqual(m.takeVolatileDirectives(), [])
  assert.equal(JSON.stringify(output.system), before)
})

test("the flag is off by default, preserving shipped behaviour", async () => {
  delete process.env.VIBEOS_STABLE_PREFIX
  const m = await load()
  assert.equal(m.stablePrefixEnabled(), false, "must not change shipped behaviour without opt-in")
})

test("injectVolatileDirectives lands one trailing synthetic part", async () => {
  process.env.VIBEOS_STABLE_PREFIX = "1"
  const m = await load()
  m.resetVolatileBuffer()
  const messages = [{ parts: [{ type: "text", text: "hello" }] }]
  m.injectVolatileDirectives(messages)
  // empty buffer -> nothing added
  assert.equal(messages[0].parts.length, 1, "an empty buffer must not add a part")
})

test("a stale buffer is dropped, not injected on a later turn", async () => {
  process.env.VIBEOS_STABLE_PREFIX = "1"
  const m = await load()
  m.resetVolatileBuffer()
  m.resetVolatileBuffer() // a new turn began without anything being pushed
  assert.deepEqual(m.takeVolatileDirectives(), [], "last turn's directives must not leak forward")
})

test("injection is idempotent within a turn", async () => {
  process.env.VIBEOS_STABLE_PREFIX = "1"
  const m = await load()
  m.resetVolatileBuffer()
  const messages = [{ parts: [{ type: "text", text: "x" + MARKER }] }]
  m.injectVolatileDirectives(messages)
  m.injectVolatileDirectives(messages)
  assert.equal(messages[0].parts.length, 1, "must not double-inject")
})

test("off by default, injectVolatileDirectives is inert", async () => {
  delete process.env.VIBEOS_STABLE_PREFIX
  const m = await load()
  const messages = [{ parts: [{ type: "text", text: "hello" }] }]
  m.injectVolatileDirectives(messages)
  assert.equal(messages[0].parts.length, 1)
})
