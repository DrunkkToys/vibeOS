// SPDX-License-Identifier: MIT
// Contract: buildQualityAssertionsForFunc() must emit REAL assertions for every
// supported language, not just JS/TS/Python. Before this fix, rust/ruby/java/kotlin
// fell into the `default` branch and got pure `// TODO: ...` comments with zero
// executable assertions -- and go bypassed buildQualityAssertionsForFunc entirely,
// inlining its own hardcoded TODO comments in test-skeletons.ts. Same "mess, not
// value" complaint as the JS/TS framework-mismatch bug, one layer further out.

import { test } from "node:test"
import assert from "node:assert/strict"

test("buildQualityAssertionsForFunc emits real assertions for rust, ruby, java, kotlin, go", async () => {
  const { buildQualityAssertionsForFunc } = await import("../src/utils/tdd-helpers.js")
  const params = [{ name: "a", type: "number" }, { name: "b", type: "number" }]

  const rs = buildQualityAssertionsForFunc("add", params, "rs", "    ")
  assert.ok(/assert(_eq)?!/.test(rs), `rust block should use real assert!/assert_eq! macros:\n${rs}`)
  assert.ok(!/TODO: Quality assertion/.test(rs), `rust block should not be a bare TODO comment:\n${rs}`)

  const rb = buildQualityAssertionsForFunc("add", params, "rb", "  ")
  assert.ok(/assert/.test(rb), `ruby block should use real Minitest assert calls:\n${rb}`)
  assert.ok(!/TODO: Quality assertion/.test(rb), `ruby block should not be a bare TODO comment:\n${rb}`)

  const java = buildQualityAssertionsForFunc("add", params, "java", "    ")
  assert.ok(/assert(NotNull|Throws|Equals|True)/.test(java), `java block should use real JUnit assertions:\n${java}`)
  assert.ok(!/TODO: Quality assertion/.test(java), `java block should not be a bare TODO comment:\n${java}`)

  const kt = buildQualityAssertionsForFunc("add", params, "kt", "    ")
  assert.ok(/assert(NotNull|Throws|Equals|True)/.test(kt), `kotlin block should use real JUnit assertions:\n${kt}`)
  assert.ok(!/TODO: Quality assertion/.test(kt), `kotlin block should not be a bare TODO comment:\n${kt}`)

  const go = buildQualityAssertionsForFunc("Add", params, "go", "\t")
  assert.ok(/t\.Error|t\.Fatal/.test(go), `go block should use real testing.T failure calls:\n${go}`)
  assert.ok(!/TODO: Quality assertion/.test(go), `go block should not be a bare TODO comment:\n${go}`)
})
