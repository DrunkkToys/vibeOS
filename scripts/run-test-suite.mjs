#!/usr/bin/env node

import { readdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const mode = (process.argv[2] || "full").toLowerCase()
const timeout = mode === "ci" ? 600000 : 240000

function collectTestFiles(dir, suffix) {
  const results = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("node_modules") && !entry.name.startsWith(".")) {
          results.push(...collectTestFiles(fullPath, suffix))
        }
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(fullPath)
      }
    }
  } catch {}
  results.sort()
  return results
}

function toCompiledTestPath(srcPath) {
  return join("dist-ts-tests", srcPath.replace(/\.ts$/, ".js"))
}

const rawTests = [
  ...collectTestFiles("tests", ".test.mjs"),
  ...collectTestFiles("src/tests", ".test.js"),
  ...collectTestFiles("src/utils/tests", ".test.mjs"),
  ...collectTestFiles("src/lib/hooks/tests", ".test.mjs"),
  ...collectTestFiles("src/lib/hooks/tests", ".test.js"),
  ...collectTestFiles("src/vibeOS-lib/tests", ".test.mjs"),
  ...collectTestFiles("scripts/tests", ".test.mjs"),
  ...collectTestFiles("scripts/tests", ".test.js"),
]

const tsTests = [
  ...collectTestFiles("tests", ".test.ts"),
  ...collectTestFiles("src/lib/tests", ".test.ts"),
  ...collectTestFiles("src/lib/hooks/tests", ".test.ts"),
  ...collectTestFiles("src/utils/tests", ".test.ts"),
  ...collectTestFiles("src/vibeOS-lib/tests", ".test.ts"),
  ...collectTestFiles("scripts/tests", ".test.ts"),
].map(toCompiledTestPath)

const tests = [...rawTests, ...tsTests]

const loader = pathToFileURL(join(process.cwd(), "scripts", "ts-src-loader.mjs")).href
const args = ["--loader", loader, "--test", `--test-timeout=${timeout}`]
if (mode === "ci") {
  args.push("--test-concurrency=1")
}
args.push(...tests)

// Isolate the uninstall marker from the developer's machine. A real
// `vibe uninstall` leaves ~/.opencode/vibeOS-uninstalled behind, and an
// uninstalled plugin registers zero hooks by design — without this every
// hook test would fail on that machine while passing in CI. Tests that
// exercise the marker set this variable themselves (node:test gives each
// file its own process, so those overrides stay local).
const markerIsolationDir = process.env.VIBEOS_UNINSTALLED_MARKER_DIR || mkdtempSync(join(tmpdir(), "vibeos-test-marker-"))

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: [`--loader ${loader}`, process.env.NODE_OPTIONS || ""].filter(Boolean).join(" "),
    VIBEOS_MCP_PORT: process.env.VIBEOS_MCP_PORT || "0",
    VIBEOS_TEST_CONTEXT: "1",
    VIBEOS_UNINSTALLED_MARKER_DIR: markerIsolationDir,
    VIBEOS_FAST_CI: mode === "ci" ? "1" : "0",
  },
})

process.exit(result.status ?? 1)
