import { execSync } from "node:child_process"

const ROOT = process.cwd()

const ALLOWED_JS = new Set([
  "bin/setup.js",
  "dist/vibeOS.js",
  "src/tests/index.test.js",
  "src/lib/tests/api-client.test.js",
  "src/lib/tests/mode-policy.test.js",
  "src/lib/tests/pricing.test.js",
  "src/lib/tests/selection-manager.test.js",
  "src/lib/tests/state.test.js",
  "src/lib/tests/trinity-tool.test.js",
  "src/lib/tests/turn-classify.test.js",
  "src/lib/hooks/tests/chat-transform-cv-gate.test.js",
  "src/lib/hooks/tests/chat-transform.test.js",
  "src/lib/hooks/tests/footer.test.js",
  "src/lib/hooks/tests/tool-execute.test.js",
  "src/vibeOS-lib/blackbox/tests/resolution-tracker.test.js",
  "src/vibeOS-lib/blackbox/tests/vibemax.test.js",
])

const jsFiles = execSync("git ls-files '*.js'", { cwd: ROOT, encoding: "utf-8" })
  .split("\n")
  .map((p) => p.trim())
  .filter(Boolean)
  .sort()

const unexpected = jsFiles.filter((p) => !ALLOWED_JS.has(p))

if (unexpected.length > 0) {
  console.error("TS audit failed: tracked JS files found:")
  for (const p of unexpected) console.error(`  - ${p}`)
  process.exit(1)
}

console.log("TS audit passed.")
console.log(`Checked ${jsFiles.length} tracked JS files.`)
