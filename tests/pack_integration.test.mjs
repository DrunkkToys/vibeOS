// SPDX-License-Identifier: MIT
// INTEGRATION: npm-packaged tarball contains required files and setup.js works.

import test from "node:test"
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { installVibeSkill } from "../scripts/lib/vibe-skill.mjs"

const ROOT = new URL("..", import.meta.url).pathname

test("integration: /vibe skill installer writes directly under OpenCode home", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-skill-home-")
  try {
    const openCodeHome = join(sandbox, ".opencode")
    const result = installVibeSkill(openCodeHome)
    assert.equal(result.path, join(openCodeHome, "skills", "vibe", "SKILL.md"))
    assert.equal(existsSync(result.path), true)
    assert.equal(existsSync(join(openCodeHome, ".opencode", "skills", "vibe", "SKILL.md")), false)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("integration: npm pack creates tarball with bin/setup.js", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-pack-")
  execSync("npm pack --silent 2>/dev/null", { cwd: ROOT, encoding: "utf8", timeout: 30000 })
  const tgz = execSync("ls -t vibeostheog-*.tgz 2>/dev/null | head -1", {
    cwd: ROOT, encoding: "utf8", timeout: 5000
  }).trim()
  const files = execSync("tar -tzf " + tgz, { cwd: ROOT, encoding: "utf8", timeout: 10000 }).split("\n").filter(Boolean)
  assert.ok(files.some(f => f.includes("bin/setup.js")), "tarball must contain bin/setup.js, got: " + files.slice(0, 5).join(", "))
  assert.ok(files.some(f => f.includes("scripts/deploy.mjs")), "tarball must contain scripts/deploy.mjs")
  assert.ok(files.some(f => f.includes("scripts/lib/opencode-homes.mjs")), "tarball must contain scripts/lib/opencode-homes.mjs")
  // The universal /vibe skill is generated from VIBE_SKILL_BODY at deploy time
  // (single source of truth), not shipped as a static pre-built copy — the
  // tarball just needs the generator.
  assert.ok(files.some(f => f.includes("scripts/lib/vibe-skill.mjs")), "tarball must contain the /vibe skill generator")
  rmSync(join(ROOT, tgz))
  rmSync(sandbox, { recursive: true, force: true })
})

test("integration: packed setup.js has no readline/confirm prompt logic", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-pack-")
  execSync("npm pack --silent 2>/dev/null", { cwd: ROOT, encoding: "utf8", timeout: 30000 })
  const tgz = execSync("ls -t vibeostheog-*.tgz 2>/dev/null | head -1", {
    cwd: ROOT, encoding: "utf8", timeout: 5000
  }).trim()
  execSync("tar -xzf " + tgz + " -C " + sandbox, { encoding: "utf8", timeout: 10000 })
  const pkgDir = join(sandbox, "package")
  const packedSetup = readFileSync(join(pkgDir, "bin", "setup.js"), "utf8")
  for (const pat of ["createInterface", "question(", "[y/N]", "[Y/n]", "confirm"]) {
    assert.equal(packedSetup.includes(pat), false, "packed setup.js must not contain: " + pat)
  }
  rmSync(sandbox, { recursive: true, force: true })
  rmSync(join(ROOT, tgz))
})
