import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const SRC = join(ROOT, "src")

const ALLOWED_JS = new Set([
  "src/index.js", // intentional runtime entrypoint (not yet migrated)
  "src/flow-enforcer.js", // compiled from src/flow-enforcer.ts
  "src/vibeOS-lib/flow-enforcer.js", // compiled from src/vibeOS-lib/flow-enforcer.ts
  "src/vibeOS-lib/session-metrics.js", // compiled from src/vibeOS-lib/session-metrics.ts
  "src/utils/cost-formatter.js", // compiled from src/utils/cost-formatter.ts
  "src/utils/timer.js", // compiled from src/utils/timer.ts
  "src/utils/math.js", // compiled from src/utils/math.ts
  "src/tests/index.test.js", // node --test skeleton kept in JS
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const jsFiles = walk(SRC)
  .map((p) => relative(ROOT, p).replaceAll("\\", "/"))
  .filter((p) => p.endsWith(".js"))
  .sort()

const unexpected = jsFiles.filter((p) => !ALLOWED_JS.has(p))

if (unexpected.length > 0) {
  console.error("TS audit failed: unexpected JS files found:")
  for (const p of unexpected) console.error(`  - ${p}`)
  process.exit(1)
}

console.log("TS audit passed.")
console.log(`Checked ${jsFiles.length} JS files in src/.`)
