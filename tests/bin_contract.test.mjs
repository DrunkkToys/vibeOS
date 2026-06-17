// SPDX-License-Identifier: MIT
// CONTRACT: vibeostheog binary CLI must be findable and executable.
// Regression guard for the npm link bin symlink that broke in v0.25.35.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, statSync, lstatSync, realpathSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

test("contract: bin field in package.json points to existing file", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  assert.ok(pkg.bin, "package.json must have bin field")
  assert.ok(pkg.bin.vibeostheog, "bin.vibeostheog must exist")
  const binPath = join(ROOT, pkg.bin.vibeostheog)
  assert.ok(existsSync(binPath), "bin/" + pkg.bin.vibeostheog + " must exist on disk")
})

test("contract: bin/setup.js has valid shebang and is executable", () => {
  const binPath = join(ROOT, "bin", "setup.js")
  const firstLine = readFileSync(binPath, "utf8").split("\n")[0]
  assert.equal(firstLine, "#!/usr/bin/env node", "first line must be shebang")
  const st = statSync(binPath)
  assert.ok(st.mode & 0o111, "bin/setup.js must be executable")
})

test("contract: bin/setup.js parses without syntax errors", () => {
  const binPath = join(ROOT, "bin", "setup.js")
  execSync("node --check " + binPath, { encoding: "utf8", timeout: 10000 })
})

test("contract: node bin/setup.js --help produces usage output", () => {
  const binPath = join(ROOT, "bin", "setup.js")
  const out = execSync("node " + binPath + " --help 2>&1 || true", { encoding: "utf8", timeout: 10000 })
  assert.ok(out.length > 0, "must produce some output")
  const keywords = ["setup", "Set", "Usage", "help"]
  const found = keywords.some(k => out.includes(k))
  assert.ok(found, "must mention setup/set/Usage/help, got: " + out.slice(0, 100))
})

test("contract: npm link bin symlink exists and points to setup.js", () => {
  const globalNodeModules = execSync("npm root -g", { encoding: "utf8", timeout: 5000 }).trim()
  const linkedPath = join(globalNodeModules, "vibeostheog")
  if (!existsSync(linkedPath)) {
    assert.ok(true, "npm link not active on this machine --- skipping")
    return
  }
  const globalBinDir = process.env.NVM_BIN || join(globalNodeModules, "..", "..", "bin")
  const binarySymlink = join(globalBinDir, "vibeostheog")
  assert.ok(existsSync(binarySymlink), "global bin symlink must exist: " + binarySymlink)
  const symStat = lstatSync(binarySymlink)
  assert.ok(symStat.isSymbolicLink(), binarySymlink + " must be a symlink")
  const resolved = realpathSync(binarySymlink)
  assert.ok(resolved.includes("setup.js"), "symlink must point to setup.js, got: " + resolved)
})