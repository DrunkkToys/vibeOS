// SPDX-License-Identifier: MIT
// CONTRACT: vibeostheog binary CLI entry point integrity.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, realpathSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const SETUP = join(ROOT, "bin", "setup.js")

test("contract: package.json bin field points to an existing executable file", () => {
  assert.ok(PKG.bin, "package.json must have bin field")
  assert.ok(PKG.bin.vibeostheog, "bin.vibeostheog must exist")
  const binPath = join(ROOT, PKG.bin.vibeostheog)
  assert.ok(existsSync(binPath), "bin/" + PKG.bin.vibeostheog + " must exist on disk")
  const st = statSync(binPath)
  assert.ok(st.isFile(), "must be a regular file")
  assert.ok((st.mode & 0o111) > 0, "bin/setup.js must have executable bits")
})

test("contract: bin/setup.js has valid shebang and parses without syntax errors", () => {
  const firstLine = readFileSync(SETUP, "utf8").split("\n")[0]
  assert.equal(firstLine, "#!/usr/bin/env node", "first line must be shebang")
  execSync("node --check " + SETUP, { encoding: "utf8", timeout: 10000 })
})

test("contract: bin/setup.js does NOT contain any readline/confirm prompt logic", () => {
  const src = readFileSync(SETUP, "utf8")
  for (const pat of ["createInterface", "question(", "[y/N]", "[Y/n]", "confirm"]) {
    assert.equal(src.includes(pat), false, "must not contain: " + pat)
  }
})

test("contract: bin/setup.js --help prints usage and exits 1", () => {
  try {
    execSync("node " + SETUP + " --help", { encoding: "utf8", timeout: 5000 })
    assert.fail("should have thrown exit code 1")
  } catch (e) {
    assert.equal(e.status, 1)
    const out = e.stdout?.toString() || e.stderr?.toString() || ""
    assert.ok(out.includes("Usage:"), "must contain Usage:")
    assert.ok(out.includes("npx"), "must mention npx")
    assert.ok(out.includes("set"), "must mention set command")
    assert.ok(out.includes("setup"), "must mention setup command")
  }
})

test("contract: bin/setup.js --yes installs and completes", { timeout: 30000 }, () => {
  const sandbox = mkdtempSync(join(realpathSync("/tmp"), "vibeos-bin-test-"))
  const out = execSync("node " + SETUP + " --yes 2>&1 || true", {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: sandbox, USER: "test" }
  })
  assert.ok(out.includes("vibeOS"), "must show vibeOS banner")
  assert.ok(out.includes("Installing to:"), "must show install target info")
  assert.ok(out.includes("Done."), "must complete with Done")
  rmSync(sandbox, { recursive: true, force: true })
})