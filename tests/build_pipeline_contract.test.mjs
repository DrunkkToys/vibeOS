// SPDX-License-Identifier: MIT
// Contract tests for build pipeline — single-bundle output, correct scripts.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

test("contract: build:bundle script is esbuild-only, no tsc or sync-ts-build", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const cmd = pkg.scripts["build:bundle"]
  assert.ok(cmd, "build:bundle script must exist")
  assert.ok(cmd.includes("build-bundle.mjs"), "must use build-bundle.mjs")
  assert.equal(cmd.includes("sync-ts-build"), false, "must NOT include sync-ts-build")
  assert.equal(cmd.includes("tsc"), false, "must NOT include tsc")
})

test("contract: build script includes typecheck before bundle", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const cmd = pkg.scripts.build
  assert.ok(cmd, "build script must exist")
  assert.ok(cmd.includes("typecheck"), "build must typecheck before bundling")
  assert.ok(cmd.includes("build:bundle"), "build must include bundle")
  assert.ok(cmd.includes("deploy"), "build must include deploy")
})

test("contract: bundle file exists at dist/vibeOS.js and is >100KB", () => {
  const bundlePath = join(ROOT, "dist", "vibeOS.js")
  assert.ok(existsSync(bundlePath), "dist/vibeOS.js must exist")
  const st = statSync(bundlePath)
  assert.ok(st.size > 100000, "bundle must be >100KB")
})
