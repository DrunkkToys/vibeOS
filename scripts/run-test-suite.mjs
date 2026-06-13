#!/usr/bin/env node

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const mode = (process.argv[2] || "full").toLowerCase()
const timeout = mode === "ci" ? 240000 : 240000

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

const tests = [
  ...collectTestFiles("tests", ".test.mjs"),
  ...collectTestFiles("src/tests", ".test.js"),
  ...collectTestFiles("src/utils/tests", ".test.mjs"),
  ...collectTestFiles("src/lib/hooks/tests", ".test.mjs"),
  ...collectTestFiles("src/lib/hooks/tests", ".test.js"),
  ...collectTestFiles("src/vibeOS-lib/tests", ".test.mjs"),
  ...collectTestFiles("scripts/tests", ".test.mjs"),
  ...collectTestFiles("scripts/tests", ".test.js"),
]

const loader = pathToFileURL(join(process.cwd(), "scripts", "ts-src-loader.mjs")).href
const args = ["--loader", loader, "--test", `--test-timeout=${timeout}`]
if (mode === "ci") {
  args.push("--test-concurrency=1")
}
args.push(...tests)

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    VIBEOS_MCP_PORT: process.env.VIBEOS_MCP_PORT || "0",
    VIBEOS_TEST_CONTEXT: "1",
    VIBEOS_FAST_CI: mode === "ci" ? "1" : "0",
  },
})

process.exit(result.status ?? 1)
