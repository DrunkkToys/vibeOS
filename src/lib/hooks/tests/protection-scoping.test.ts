import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mod = await import("../tool-execute.js?t=" + Date.now())

function makeRepo(root, isPlugin) {
  const repo = join(root, isPlugin ? "plugin-repo" : "ext-proj")
  mkdirSync(join(repo, "src", "vibeOS-lib"), { recursive: true })
  mkdirSync(join(repo, "tests"), { recursive: true })
  mkdirSync(join(repo, "dist"), { recursive: true })
  if (isPlugin) writeFileSync(join(repo, "dist", "vibeOS.js"), "// plugin\n")
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: isPlugin ? "vibeostheog" : "some-app" }))
  return repo
}

test("protection: self-modification guard fires inside the plugin repo", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-prot-"))
  const repo = makeRepo(root, true)
  assert.equal(mod._isProtectedToolPathForTest(repo, join(repo, "src/vibeOS-lib/core.ts")), true, "src/vibeOS-lib must be protected in the plugin repo")
  assert.equal(mod._isProtectedToolPathForTest(repo, join(repo, "package.json")), true)
  assert.equal(mod._isProtectedToolPathForTest(repo, join(repo, "tests/x.test.ts")), true)
})

test("protection: guard does NOT fire in an unrelated project", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-prot-"))
  const proj = makeRepo(root, false)
  assert.equal(mod._isProtectedToolPathForTest(proj, join(proj, "tests/foo.test.ts")), false, "tests/ must be writable outside the plugin repo")
  assert.equal(mod._isProtectedToolPathForTest(proj, join(proj, "src/index.ts")), false, "src/ must be writable outside the plugin repo")
  assert.equal(mod._isProtectedToolPathForTest(proj, join(proj, "package.json")), false)
  assert.equal(mod._isProtectedToolPathForTest(proj, join(proj, "README.md")), false)
})
