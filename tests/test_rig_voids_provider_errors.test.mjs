// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"

import { providerErrors, voidReason } from "../scripts/e2e/ml-task/score.mjs"

const OK_TURNS = [{ id: "implement", status: 0 }]
const UNAVAILABLE = JSON.stringify({ type: "error", sessionID: "s", error: { name: "APIError", data: { message: "Upstream request failed: Model is unavailable.", statusCode: 400 } } })

test("provider errors in a turn's output are found", () => {
  assert.deepEqual(providerErrors(`{"type":"text"}\n${UNAVAILABLE}\n`), ["APIError: Upstream request failed: Model is unavailable."])
  assert.deepEqual(providerErrors('{"type":"text","part":{"text":"APIError is a class"}}\nnot json\n'), [])
})

test("a raw trial whose model never answered is void, not a fail", () => {
  const r = voidReason("raw", OK_TURNS, { homeFiles: [], providerErrors: ["APIError: Upstream request failed: Model is unavailable."] }, null)
  assert.match(r, /model did not answer/)
  assert.match(r, /Model is unavailable/)
})

test("a plugin trial with a provider error is void too", () => {
  assert.match(voidReason("flow", OK_TURNS, { homeFiles: [], providerErrors: ["APIError: x"] }, null), /model did not answer/)
})

test("a trial with no provider errors is judged as before", () => {
  assert.equal(voidReason("raw", OK_TURNS, { homeFiles: [], providerErrors: [] }, null), null)
  assert.equal(voidReason("raw", OK_TURNS, { homeFiles: [] }, null), null)
})
