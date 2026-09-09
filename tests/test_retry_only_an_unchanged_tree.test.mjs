// SPDX-License-Identifier: MIT
// Contract: a killed turn is retried only when it provably changed nothing.
//
// The rule shipped in #561 retried on `stdoutBytes === 0 && mutatingCalls === 0`.
// Both fields are parsed from the stdout of the process the kill destroyed, and
// `opencode run --format json` does not stream: a 27s turn allowed to finish
// wrote 2325 bytes, the same turn killed at 12s wrote 0. So a killed turn ALWAYS
// reports zero bytes and zero mutating calls, whether it edited every file in the
// repo or none of them. The guard meant to stop a double-applied edit was blind
// in exactly the case it existed for.
//
// The file tree is the evidence the kill cannot erase.
//
// This supersedes tests/test_retry_a_silent_hang.test.mjs, whose premise -- "wrote
// zero bytes to stdout, so nothing was half-done" -- is the claim measurement
// refuted; its remaining coverage is folded in below. The motivation is unchanged
// and still stands: run22 lost three of four trials to timeouts on turns the
// control had completed in under three minutes, and those turns are worth
// retrying. Only the test for "did it do anything" has changed.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { retryDecision } from "../scripts/e2e/ml-task/score.mjs"
import { hashTree } from "../scripts/e2e/ml-task/tree-hash.mjs"

const killed = (over) => ({ id: "fix-rest", status: null, timedOut: true, stdoutBytes: 0, mutatingCalls: 0, errorText: "", ...over })

test("a killed turn that changed the repo is not retried", () => {
  const d = retryDecision(killed({ treeChanged: true }), 0)
  assert.equal(d.retry, false, "re-sending the prompt would double-apply the edit")
  assert.match(d.reason, /change/i)
})

test("a killed turn that changed nothing is retried once", () => {
  const first = retryDecision(killed({ treeChanged: false }), 0)
  assert.equal(first.retry, true)
  assert.ok(first.waitMs > 0)
  const second = retryDecision(killed({ treeChanged: false }), 1)
  assert.equal(second.retry, false, "a hang that is the plugin's own must not cost a timeout per attempt")
})

test("with no tree evidence a killed turn is not retried", () => {
  // Zero bytes is not evidence. Absence of a hash means we do not know, and
  // "we do not know" must not read as "nothing happened".
  for (const t of [killed({}), killed({ treeChanged: null })]) {
    const d = retryDecision(t, 0)
    assert.equal(d.retry, false, "unknown tree state must fail safe")
    assert.match(d.reason, /unknown|not know|no tree/i)
  }
})

test("a transient provider failure that changed the repo is not retried either", () => {
  const t = { id: "x", status: 1, timedOut: false, stdoutBytes: 900, mutatingCalls: 0, treeChanged: true, errorText: "Service temporarily overloaded" }
  assert.equal(retryDecision(t, 0).retry, false, "the tree outranks the tool-call count")
})

test("a transient provider failure with a clean tree still retries", () => {
  const t = { id: "x", status: 1, timedOut: false, stdoutBytes: 900, mutatingCalls: 0, treeChanged: false, errorText: "Service temporarily overloaded" }
  assert.equal(retryDecision(t, 0).retry, true)
})

test("the tree hash sees a content change and ignores node_modules", () => {
  const dir = mkdtempSync(join(tmpdir(), "tree-hash-"))
  try {
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "src", "a.mjs"), "export const a = 1\n")
    const before = hashTree(dir)
    assert.equal(hashTree(dir), before, "the same tree hashes the same twice")

    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "noise\n")
    mkdirSync(join(dir, ".git"), { recursive: true })
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
    assert.equal(hashTree(dir), before, "installs and git internals are not the model's edits")

    writeFileSync(join(dir, "src", "a.mjs"), "export const a = 2\n")
    assert.notEqual(hashTree(dir), before, "an edited file must change the hash")

    const edited = hashTree(dir)
    writeFileSync(join(dir, "src", "b.mjs"), "export const b = 3\n")
    assert.notEqual(hashTree(dir), edited, "a new file must change the hash")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a missing directory hashes to null rather than throwing", () => {
  assert.equal(hashTree(join(tmpdir(), "no-such-dir-" + Date.now())), null)
})

test("the rig hashes the trial project around every attempt", () => {
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /hashTree/, "runTurnWithRetry must measure the tree itself")
  assert.match(rig, /treeChanged/, "the turn result must carry the verdict retryDecision reads")
})

test("a non-timeout failure with no retryable error is not retried", () => {
  const t = { id: "x", status: 1, timedOut: false, stdoutBytes: 0, mutatingCalls: 0, treeChanged: false, errorText: " " }
  assert.equal(retryDecision(t, 0).retry, false)
})

test("the rules that predate the tree hash are untouched", () => {
  assert.equal(retryDecision({ status: 0 }, 0).reason, "succeeded")
  const rateLimited = { status: 1, errorText: "429 too many requests", mutatingCalls: 0 }
  assert.equal(retryDecision(rateLimited, 0).retry, true)
  assert.equal(retryDecision({ status: 1, errorText: "429", mutatingCalls: 1 }, 0).retry, false)
  assert.equal(retryDecision(rateLimited, 3).reason, "retries exhausted")
})
