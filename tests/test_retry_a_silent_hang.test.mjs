// SPDX-License-Identifier: MIT
// A turn that hit the timeout having emitted nothing at all.
//
// run22 lost three of four trials this way. raw-1's "pivot" turn and
// vibeultrax-0's "diagnose" turn both ran the full 1800s and wrote zero bytes to
// stdout and zero to stderr -- the same turn raw-0 completed in 169s. The rig
// declined to retry either: errorText was empty, so RETRYABLE did not match, so
// it was filed as "not a transient provider failure".
//
// It is the opposite. Nothing was emitted, no tool ran and the repo was not
// touched, so nothing was half-done and the turn is safe to run again. That is
// the only class of timeout where that is true.
import test from "node:test"
import assert from "node:assert/strict"

import { retryDecision, RETRY_BACKOFF_MS } from "../scripts/e2e/ml-task/score.mjs"

const hang = (over = {}) => ({ status: -1, timedOut: true, stdoutBytes: 0, mutatingCalls: 0, errorText: " ", ...over })

test("a timeout that produced nothing is retried once", () => {
  const d = retryDecision(hang(), 0)
  assert.equal(d.retry, true)
  assert.equal(d.waitMs, RETRY_BACKOFF_MS[0])
  assert.match(d.reason, /silent/i)
})

test("it is retried once and not again, so a deterministic hang cannot eat the run", () => {
  const d = retryDecision(hang(), 1)
  assert.equal(d.retry, false)
  assert.match(d.reason, /already retried/i)
})

test("a timeout that produced output is not retried -- the session advanced", () => {
  assert.equal(retryDecision(hang({ stdoutBytes: 4096 }), 0).retry, false)
})

test("a timeout that changed the repo is not retried", () => {
  assert.equal(retryDecision(hang({ mutatingCalls: 2 }), 0).retry, false)
})

test("a non-timeout failure with no output is still not retried", () => {
  assert.equal(retryDecision(hang({ timedOut: false }), 0).retry, false)
})

test("the existing rules are untouched", () => {
  assert.equal(retryDecision({ status: 0 }, 0).reason, "succeeded")
  const rateLimited = { status: 1, errorText: "429 too many requests", mutatingCalls: 0 }
  assert.equal(retryDecision(rateLimited, 0).retry, true)
  assert.equal(retryDecision({ status: 1, errorText: "429", mutatingCalls: 1 }, 0).retry, false)
  assert.equal(retryDecision(rateLimited, 3).reason, "retries exhausted")
})
