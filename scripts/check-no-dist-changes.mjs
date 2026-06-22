#!/usr/bin/env node
import { execSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname
const isCi = process.argv.includes("--ci") || process.env.CI === "true"

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function fail(message) {
  process.stderr.write(`[vibeOS] ${message}\n`)
  process.exit(1)
}

function listPaths(cmd) {
  try {
    const output = run(cmd)
    return output ? output.split("\n").map((s) => s.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

const staged = listPaths("git diff --cached --name-only --diff-filter=ACMRT -- dist/")
if (staged.length > 0) {
  fail(`dist/ changes are not allowed in commits:\n${staged.map((p) => `  - ${p}`).join("\n")}`)
}

if (isCi) {
  const eventName = process.env.GITHUB_EVENT_NAME ?? ""
  const baseCommit = eventName === "pull_request" || eventName === "pull_request_target" ? "HEAD^1" : "HEAD^"
  const changed = listPaths(`git diff --name-only --diff-filter=ACMRT ${baseCommit} HEAD -- dist/`)
  if (changed.length > 0) {
    fail(`dist/ changes are not allowed in PRs:\n${changed.map((p) => `  - ${p}`).join("\n")}`)
  }
}
