// SPDX-License-Identifier: MIT
// Contract tests for build pipeline — single-bundle output, correct scripts.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
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

test("contract: build bundle emits bin/setup.js from src/bin/setup.ts", () => {
  const src = readFileSync(join(ROOT, "scripts", "build-bundle.mjs"), "utf8")
  assert.ok(src.includes('join(SRC, "bin", "setup.ts")'), "must build setup.ts")
  assert.ok(src.includes('join(ROOT, "bin", "setup.js")'), "must emit bin/setup.js")
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

test("contract: src does not contain committed JS mirrors", () => {
  const allowed = new Set([
    "src/index.js",
    "src/lib/hooks/tests/chat-transform-cv-gate.test.js",
    "src/lib/tests/mode-router.test.js",
    "src/tests/fallback-regex.test.js",
  ])

  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith(".js") && full.includes(`${join(ROOT, "src")}`)) {
        const rel = full.slice(ROOT.length + 1)
        const tsTwin = full.replace(/\.js$/, ".ts")
        if (!allowed.has(rel) && existsSync(tsTwin)) found.push(rel)
      }
    }
  }

  walk(join(ROOT, "src"))
  assert.deepEqual(found, [], "unexpected committed JS files under src: " + found.join(", "))
})
