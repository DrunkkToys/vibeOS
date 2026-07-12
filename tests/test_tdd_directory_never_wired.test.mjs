// SPDX-License-Identifier: MIT
// Contract: tdd-enforcer.ts's framework detection must use the real project
// directory, not process.cwd(). Live-reproduced in OpenCode Desktop: the
// plugin's `directory` module-level variable in tdd-enforcer.ts was declared
// but never assigned anywhere, so _detectTestFramework() always fell back to
// process.cwd() -- which for the GUI app process is NOT the project root.
// Framework detection silently defaulted away from node:test (this repo's
// real framework) to vitest, producing skeletons that import a package
// (`vitest`) not installed in the project at all.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-tdd-dir-"))
mkdirSync(join(sandbox, "tests"), { recursive: true })
writeFileSync(
  join(sandbox, "tests", "sample.test.mjs"),
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\ntest('x', () => assert.ok(true))\n",
)
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

test("buildTestSkeleton detects node:test from the wired project directory, not process.cwd()", async () => {
  const enforcer = await import("../src/lib/tdd-enforcer.js")
  assert.equal(typeof enforcer.setTddDirectory, "function", "tdd-enforcer.js must export setTddDirectory")
  enforcer.setTddDirectory(sandbox)
  const skeleton = enforcer.buildTestSkeleton(
    join(sandbox, "fake-module.ts"),
    "export function add(a, b) { return a + b }\n",
    { strict: true, quality: true },
  )
  assert.ok(skeleton, "skeleton should be generated")
  assert.ok(
    !/from ['"]vitest['"]/.test(skeleton.content),
    `should not fall back to vitest when the wired directory has a node:test fixture:\n${skeleton.content}`
  )
  assert.ok(/from ['"]node:test['"]/.test(skeleton.content), "should detect node:test from the wired directory")
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
