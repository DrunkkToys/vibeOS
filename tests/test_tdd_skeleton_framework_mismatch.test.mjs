// SPDX-License-Identifier: MIT
// Contract: buildTestSkeleton()'s "quality" assertion block for js/ts/mjs must use
// the SAME test framework API as the rest of the generated file. Previously
// buildQualityAssertionsForFunc() hardcoded Jest's `expect(...).toBeDefined()`
// regardless of the detected framework, so a node:test project (like this repo)
// got a skeleton file mixing `assert.ok(...)` boilerplate with `expect(...)`
// calls that don't exist under node:test -- the generated test crashes with
// "expect is not defined" instead of providing real test value.

import { test } from "node:test"
import assert from "node:assert/strict"

test("node-test framework skeleton never emits jest's expect() API", async () => {
  const { buildTestSkeleton } = await import("../src/lib/tdd-enforcer.js")
  const src = "export function add(a, b) { return a + b }\n"
  const skeleton = buildTestSkeleton("/tmp/fake-module-nodetest.ts", src, { strict: true, quality: true })
  assert.ok(skeleton, "skeleton should be generated")
  assert.ok(
    !/\bexpect\(/.test(skeleton.content),
    `node:test skeleton must not reference jest's expect() API:\n${skeleton.content}`
  )
  assert.ok(
    /assert\.(ok|strictEqual)/.test(skeleton.content),
    "node:test skeleton should use node:assert APIs for the quality assertion block"
  )
})
