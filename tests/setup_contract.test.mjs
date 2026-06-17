// SPDX-License-Identifier: MIT
// CONTRACT: vibeostheog setup.js permission prompt, usage, and exit codes.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SETUP = join(ROOT, "bin", "setup.js")

test("contract: setup.js --yes exits with code 0 (non-interactive)", () => {
  const out = execSync('node "' + SETUP + '" --yes 2>&1 || true', {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, CI: "1", VIBEOS_MCP_PORT: "0" },
  })
  assert.ok(out.includes("Done") || out.includes("Already"),
    "must complete deploy, got: " + out.slice(0, 200))
})

test("contract: setup.js with invalid command exits code 1", () => {
  try {
    execSync('node "' + SETUP + '" bogus', { encoding: "utf8", timeout: 5000, stdio: "pipe" })
    assert.fail("should have thrown")
  } catch (e) {
    assert.ok(e.status === 1, "exit code must be 1, got: " + e.status)
    const stderr = e.stderr?.toString() || ""
    assert.ok(stderr.includes("Usage"), "stderr must show usage: " + stderr.slice(0, 100))
  }
})

test("contract: setup.js --help shows usage", () => {
  const out = execSync('node "' + SETUP + '" --help 2>&1 || true', {
    encoding: "utf8", timeout: 5000,
  })
  assert.ok(out.includes("Usage"), "must show usage line")
  assert.ok(out.includes("set") && out.includes("setup"), "must mention set and setup commands")
})

test("contract: setup.js --project flag is accepted", () => {
  const out = execSync('node "' + SETUP + '" --yes --project 2>&1 || true', {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, CI: "1", VIBEOS_MCP_PORT: "0" },
  })
  assert.ok(out.includes("Done") || out.includes("Already") || out.includes("registered"),
    "must handle --project, got: " + out.slice(0, 200))
})

test("contract: setup.js does NOT prompt (npx is the single permission gate)", () => {
  const src = readFileSync(SETUP, "utf8")
  assert.equal(src.includes("question("), false, "must NOT call readline question")
  assert.equal(src.includes("[y/N]"), false, "must NOT contain y/N prompt pattern")
  assert.equal(src.includes("Installation cancelled"), false, "must NOT have cancellation message")
})
