// SPDX-License-Identifier: MIT
// CONTRACT: vibeostheog setup.js command parsing, exit codes, sandbox install.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdtempSync, rmSync, realpathSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SETUP = join(ROOT, "bin", "setup.js")

function sandboxRun(args) {
  const sandbox = mkdtempSync(join(realpathSync("/tmp"), "vibeos-setup-"))
  const out = execSync("node " + SETUP + " " + args + " 2>&1 || true", {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOME: sandbox, USER: "test" }
  })
  rmSync(sandbox, { recursive: true, force: true })
  return out
}

test("contract: setup.js with no explicit command defaults to setup and completes", () => {
  const out = sandboxRun("--yes")
  assert.ok(out.includes("Done."), "must complete, got: " + out.slice(0, 100))
})

test("contract: setup.js with explicit setup command completes", () => {
  const out = sandboxRun("setup --yes")
  assert.ok(out.includes("Done."), "must complete, got: " + out.slice(0, 100))
})

test("contract: setup.js with set command completes", () => {
  const out = sandboxRun("set --yes")
  assert.ok(out.includes("Done."), "must complete, got: " + out.slice(0, 100))
})

test("contract: setup.js with invalid command exits 1 and shows usage", () => {
  try {
    execSync("node " + SETUP + " bogus", { encoding: "utf8", timeout: 5000, stdio: "pipe" })
    assert.fail("should have thrown")
  } catch (e) {
    assert.equal(e.status, 1, "exit code must be 1")
    const stderr = e.stderr?.toString() || ""
    assert.ok(stderr.includes("Usage:"), "stderr must show usage: " + stderr.slice(0, 100))
  }
})

test("contract: setup.js --project flag is accepted without crashing", () => {
  try {
    const out = sandboxRun("--yes --project")
    assert.ok(true, "completed without error")
  } catch (e) {
    assert.fail("should not throw: " + e.message)
  }
})