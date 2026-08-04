// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// api-client captures getVibeOSHome() at module load, so the home must be set
// before the dynamic import below.
const TEST_HOME = mkdtempSync(join(tmpdir(), "vibeos-sec-"))
const SAVED_HOME = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = TEST_HOME

const api = await import("../api-client.js?test=" + Date.now())

const VALID_TOKEN = "vos_" + "a".repeat(64)

function modeBits(path) {
  return statSync(path).mode & 0o777
}

test.after(() => {
  if (SAVED_HOME === undefined) delete process.env.VIBEOS_HOME
  else process.env.VIBEOS_HOME = SAVED_HOME
  rmSync(TEST_HOME, { recursive: true, force: true })
})

test("api-client: bootstrap token persisted atomically with 0600 perms", () => {
  api.setApiBootstrapToken(VALID_TOKEN)
  const path = join(TEST_HOME, ".env.alpha")
  assert.ok(statSync(path), ".env.alpha must exist")
  assert.equal(modeBits(path), 0o600, "token file must be 0600")
  const leftovers = readdirSync(TEST_HOME).filter((f) => f.includes(".tmp"))
  assert.equal(leftovers.length, 0, `no tmp litter: ${leftovers.join(",")}`)
  const content = readFileSync(path, "utf8")
  assert.ok(content.includes(`VIBEOS_API_BOOTSTRAP_TOKEN=${VALID_TOKEN}`), "token content written")
})

test("api-client: primary token env persisted with 0600 perms", () => {
  api.setApiToken(VALID_TOKEN)
  const path = join(TEST_HOME, ".env.production")
  assert.ok(statSync(path), ".env.production must exist")
  assert.equal(modeBits(path), 0o600, "primary env file must be 0600")
  const leftovers = readdirSync(TEST_HOME).filter((f) => f.includes(".tmp"))
  assert.equal(leftovers.length, 0, `no tmp litter: ${leftovers.join(",")}`)
})

test("api-client: reading a world-readable token file tightens it to 0600", () => {
  const path = join(TEST_HOME, ".env.production")
  writeFileSync(path, `VIBEOS_API_TOKEN=${VALID_TOKEN}\n`, { mode: 0o644 })
  // resolveApiToken triggers secureTokenFileOnRead via readPrimaryEnvFile
  assert.equal(api.resolveApiToken(), VALID_TOKEN, "token readable")
  assert.equal(modeBits(path), 0o600, "token file must be tightened to 0600 on read")
})
