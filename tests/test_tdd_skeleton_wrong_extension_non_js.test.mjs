// SPDX-License-Identifier: MIT
// Contract: buildTestSkeleton() must never override a non-JS test file's extension
// with the detected JS test framework's extension. Live-reproduced: a Rust source
// file (scratch-rust-verify.rs) got a skeleton test written to
// scratch-rust-verify_test.js -- raw Rust syntax (#[cfg(test)], mod tests, fn ...)
// inside a .js file, which cargo test can never discover and no JS tool can parse.
// Root cause: buildTestSkeleton() unconditionally applied `fw.testExt` (the JS
// framework's detected extension, e.g. "js" for node:test) to testPath's final
// extension, regardless of the source file's actual language.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-tdd-ext-"))
mkdirSync(join(sandbox, "tests"), { recursive: true })
const { writeFileSync } = await import("node:fs")
writeFileSync(
  join(sandbox, "tests", "sample.test.mjs"),
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\ntest('x', () => assert.ok(true))\n",
)
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

test("rust skeleton path keeps a .rs extension even when the project's JS framework is node:test", async () => {
  const enforcer = await import("../src/lib/tdd-enforcer.js")
  enforcer.setTddDirectory(sandbox)
  const skeleton = enforcer.buildTestSkeleton(
    join(sandbox, "scratch.rs"),
    "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
    { strict: true, quality: true },
  )
  assert.ok(skeleton, "skeleton should be generated")
  assert.ok(skeleton.path.endsWith(".rs"), `rust skeleton path must end in .rs, got: ${skeleton.path}`)
  assert.ok(!skeleton.path.endsWith(".js"), `rust skeleton path must not be overridden to .js: ${skeleton.path}`)
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
