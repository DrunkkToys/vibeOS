#!/usr/bin/env node
import { execSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname
let exitCode = 0

function run(label, cmd) {
  try {
    console.log(`\n=== ${label} ===`)
    execSync(cmd, { cwd: ROOT, stdio: "inherit", timeout: 120000 })
    console.log(`PASS: ${label}`)
    return true
  } catch {
    console.log(`FAIL: ${label}`)
    exitCode = 1
    return false
  }
}

run("Syntax check", "node --check src/index.js")
run("TypeScript typecheck", "npx tsc -p tsconfig.json --noEmit")
run("Strict typecheck (graduated)", "npx tsc -p tsconfig.strict.json --noEmit")
run("ESLint (errors only)", "npx eslint src/ --no-warn-ignored --max-warnings 562")

console.log(exitCode === 0 ? "\nAll checks passed." : "\nSome checks failed.")
process.exit(exitCode)
