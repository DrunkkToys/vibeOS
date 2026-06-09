#!/usr/bin/env node

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const mode = (process.argv[2] || "full").toLowerCase()
const timeout = mode === "ci" ? 120000 : 240000

function listDirFiles(dir, suffix) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

const runnableTests = [
  ...listDirFiles("tests", ".mjs"),
  ...listDirFiles("src/tests", ".js"),
  ...listDirFiles("src/utils/tests", ".mjs"),
  ...listDirFiles("src/vibeOS-lib/tests", ".mjs"),
  "src/lib/hooks/tests/chat-transform-cv-gate.test.js",
  "src/lib/hooks/tests/sync-control-settings.test.mjs",
].filter(Boolean)

const integrationPattern = /(integration|e2e|deep|workflow|pipeline)/i
const integrationTests = runnableTests.filter((testFile) => integrationPattern.test(testFile))
const unitTests = runnableTests.filter((testFile) => !integrationPattern.test(testFile))

function runTests(tests) {
  const uniqueTests = [...new Set(tests)]
  const result = spawnSync(process.execPath, ["--test", `--test-timeout=${timeout}`, ...uniqueTests], {
    stdio: "inherit",
    env: {
      ...process.env,
      VIBEOS_MCP_PORT: process.env.VIBEOS_MCP_PORT || "0",
    },
  })

  return result.status ?? 1
}

if (mode === "unit") {
  process.exit(runTests(unitTests))
}

if (mode === "integration") {
  process.exit(runTests(integrationTests))
}

if (mode === "ci") {
  const unitStatus = runTests(unitTests)
  if (unitStatus !== 0) process.exit(unitStatus)
  process.exit(runTests(integrationTests))
}

const unitStatus = runTests(unitTests)
if (unitStatus !== 0) process.exit(unitStatus)
process.exit(runTests(integrationTests))
