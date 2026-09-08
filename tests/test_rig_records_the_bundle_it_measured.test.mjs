// SPDX-License-Identifier: MIT
// A run that cannot say which build it measured cannot support a claim about
// which fix moved a number.
//
// run20 and run21 both loaded the main checkout's dist/vibeOS.js, which has been
// rebuilt many times since; their provenance is unrecoverable. I attributed a
// drop in internal-error counts across those runs to three specific PRs before
// checking, and run22 turned out to be pinned to a worktree that contains none
// of them.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readBundleProvenance } from "../scripts/e2e/ml-task/provenance.mjs"

test("a missing bundle reports the reason instead of throwing", () => {
  const res = readBundleProvenance(join(tmpdir(), "no-such-dir-" + Date.now(), "vibeOS.js"))
  assert.equal(res.error, "bundle not found")
})

test("the bundle is identified by its content, not by its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "prov-plain-"))
  try {
    const bundle = join(dir, "vibeOS.js")
    writeFileSync(bundle, "// build A\n")
    const res = readBundleProvenance(bundle)
    assert.equal(res.sha256, createHash("sha256").update("// build A\n").digest("hex"))
    assert.equal(res.bytes, Buffer.byteLength("// build A\n"))
    assert.equal(res.commit, null, "a directory outside git has no commit, and that is not an error")
    assert.equal(res.error, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("a bundle built inside a clean git worktree is pinned to its commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "prov-git-"))
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
  try {
    git("init", "-q", "-b", "main")
    git("config", "user.email", "rig@example.invalid")
    git("config", "user.name", "rig")
    writeFileSync(join(dir, "src.txt"), "one\n")
    mkdirSync(join(dir, "dist"), { recursive: true })
    writeFileSync(join(dir, "dist", "vibeOS.js"), "// built\n")
    git("add", "-A")
    git("commit", "-q", "-m", "the commit under test")
    const res = readBundleProvenance(join(dir, "dist", "vibeOS.js"))
    assert.match(res.commit, /^[0-9a-f]{40}$/)
    assert.equal(res.subject, "the commit under test")
    assert.equal(res.dirty, false)

    writeFileSync(join(dir, "src.txt"), "two\n")
    const after = readBundleProvenance(join(dir, "dist", "vibeOS.js"))
    assert.equal(after.dirty, true, "uncommitted changes mean the commit does not identify the build")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the rig records the provenance of the bundle it ran", () => {
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /readBundleProvenance/, "ml-impact must read the bundle's provenance")
  assert.match(rig, /provenance\.json/, "and write it beside results.json")
})
