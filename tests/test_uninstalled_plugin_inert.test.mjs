// SPDX-License-Identifier: MIT
// Contract: once the uninstall marker exists, a vibeOS bundle still loaded in
// memory registers ZERO hooks and recreates NO state. Without this, the very
// next turn rebuilt VIBEOS_HOME and re-registered the tier agents, which is
// what made `vibe uninstall` look like it only half-worked.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const { DelegationEnforcer } = await import("../src/index.js")
const { isVibeOSUninstalled } = await import("../src/lib/runtime-config.js")

function withMarker(fn) {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-marker-"))
  const prevMarkerDir = process.env.VIBEOS_UNINSTALLED_MARKER_DIR
  const prevVibeHome = process.env.VIBEOS_HOME
  const vibeHome = join(dir, "state")
  process.env.VIBEOS_UNINSTALLED_MARKER_DIR = dir
  process.env.VIBEOS_HOME = vibeHome
  try {
    return fn({ dir, vibeHome })
  } finally {
    if (prevMarkerDir === undefined) delete process.env.VIBEOS_UNINSTALLED_MARKER_DIR
    else process.env.VIBEOS_UNINSTALLED_MARKER_DIR = prevMarkerDir
    if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevVibeHome
    rmSync(dir, { recursive: true, force: true })
  }
}

test("marker detection is off by default and on once the file exists", () => {
  withMarker(({ dir }) => {
    assert.equal(isVibeOSUninstalled(), false)
    writeFileSync(join(dir, "vibeOS-uninstalled"), "x")
    assert.equal(isVibeOSUninstalled(), true)
  })
})

test("an uninstalled plugin registers no hooks and creates no state", async () => {
  await withMarker(async ({ dir, vibeHome }) => {
    writeFileSync(join(dir, "vibeOS-uninstalled"), "x")
    const hooks = await DelegationEnforcer({ client: null, directory: process.cwd() })
    assert.deepEqual(hooks, {}, "uninstalled plugin must expose zero hooks")
    assert.equal(existsSync(vibeHome), false, "uninstalled plugin must not recreate VIBEOS_HOME")
  })
})
