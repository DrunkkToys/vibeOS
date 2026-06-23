// SPDX-License-Identifier: MIT
// Persistent project knowledge tree tests.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let sandbox = null
const prevVibeHome = process.env.VIBEOS_HOME

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-tree-test-"))
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
  }
}

let _q = 0
function freshTree() {
  return import("../src/lib/project-tree.js?tree-test=" + (++_q) + "-" + Date.now())
}

test("records facts under topic branches and reads them back", async () => {
  ensureSandbox()
  const { recordProjectFact, loadProjectTree } = await freshTree()
  assert.ok(recordProjectFact("fp1", "demo", "auth", "decision", "use JWT in cookies"))
  assert.ok(recordProjectFact("fp1", "demo", "auth", "blocker", "refresh token rotation TBD"))
  assert.ok(recordProjectFact("fp1", "demo", "billing", "fact", "Stripe webhooks at /hooks"))
  const tree = loadProjectTree("fp1")
  assert.equal(tree.name, "demo")
  assert.equal(Object.keys(tree.branches).length, 2, "two branches: auth + billing")
  assert.equal(tree.branches.auth.facts.length, 2)
  assert.equal(tree.branches.auth.facts[0].kind, "decision")
})

test("dedupes identical facts within a branch", async () => {
  ensureSandbox()
  const { recordProjectFact, loadProjectTree } = await freshTree()
  recordProjectFact("fp2", "demo", "x", "fact", "same thing")
  recordProjectFact("fp2", "demo", "x", "fact", "same thing")
  const tree = loadProjectTree("fp2")
  assert.equal(tree.branches.x.facts.length, 1, "identical fact recorded once")
})

test("rejects empty input", async () => {
  ensureSandbox()
  const { recordProjectFact } = await freshTree()
  assert.equal(recordProjectFact("fp3", "demo", "x", "fact", "   "), false)
  assert.equal(recordProjectFact("", "demo", "x", "fact", "real"), false)
})

test("projectTreeDirective condenses to one line per branch (null when empty)", async () => {
  ensureSandbox()
  const { recordProjectFact, projectTreeDirective } = await freshTree()
  assert.equal(projectTreeDirective("nope"), null, "no knowledge → null")
  recordProjectFact("fp4", "demo", "auth", "decision", "use JWT")
  const d = projectTreeDirective("fp4")
  assert.match(d, /project knowledge: demo/)
  assert.match(d, /auth:/)
  assert.match(d, /use JWT/)
})

test("CLEANUP", async () => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = prevVibeHome
  assert.ok(true)
})
