import { existsSync, unlinkSync, copyFileSync } from "node:fs"
import { join } from "node:path"

// Build the list of lib modules to sync
const libModules = [
  "api-client", "pricing", "state", "turn-classify", "tdd-enforcer",
  "cost-anomaly", "index-helpers", "research-audit", "reporting", "credit-api", "selection-manager",
  "runtime-surface", "classifiers", "test-skeletons", "templates", "text-compress",
  "mode-policy", "mode-router", "turn-memo", "pattern-helpers", "trinity-rebuild", "trinity-tool", "runtime-state",
  "constants", "claim-verification",
]

const hookModules = [
  "footer", "tool-execute", "chat-transform", "session-compact", "shell-env", "shared-footer",
]

const cleanupPaths = [
  ...libModules.map((mod) => join("src", "lib", `${mod}.js`)),
  ...hookModules.map((mod) => join("src", "lib", "hooks", `${mod}.js`)),
  join("src", "index.js"),
  join("src", "vibeOS-lib", "flow-enforcer.js"),
  join("src", "flow-enforcer.js"),
  join("src", "vibeOS-lib", "session-metrics.js"),
  join("src", "utils", "cost-formatter.js"),
  join("src", "utils", "timer.js"),
  join("src", "utils", "math.js"),
  join("src", "utils", "tdd-helpers.js"),
  join("src", "utils", "fs-helpers.js"),
  join("src", "vibeOS-lib", "ml-router.js"),
  join("src", "vibeOS-lib", "reward-engine.js"),
  join("src", "vibeOS-lib", "laziness-detector.js"),
  join("src", "vibeOS-lib", "lie-detector.js"),
  join("src", "vibeOS-lib", "smart-cache.js"),
  join("src", "vibeOS-lib", "semantic-observer.js"),
  join("src", "lib", "vibeos-mcp-server.js"),
  join("src", "vibeOS-lib", "blackbox", "index.js"),
  join("src", "vibeOS-lib", "blackbox", "advice-layer.js"),
  join("src", "vibeOS-lib", "blackbox", "crew-constants.js"),
  join("src", "vibeOS-lib", "blackbox", "exposure-model.js"),
  join("src", "vibeOS-lib", "blackbox", "local-stub.js"),
  join("src", "vibeOS-lib", "blackbox", "meta-controller.js"),
  join("src", "vibeOS-lib", "blackbox", "resolution-tracker.js"),
  join("src", "vibeOS-lib", "blackbox", "taxonomy.js"),
  join("src", "vibeOS-lib", "blackbox", "vibemax.js"),
  join("src", "vibeOS-lib", "blackbox", "vibeqmax.js"),
  join("src", "vibeOS-lib", "blackbox", "vibeultrax.js"),
  join("src", "vibeOS-lib", "blackbox", "pivot-cache.js"),
]

for (const target of cleanupPaths) {
  if (!existsSync(target)) continue
  try {
    unlinkSync(target)
  } catch (error) {
    process.stderr.write(`[sync-ts-build] Failed to remove generated file: ${target}\n`)
    throw error
  }
}

console.log("Cleaned generated JS artifacts from src/")

// Now copy compiled JS from dist-ts/ to src/
const ROOT = new URL("..", import.meta.url).pathname
const distTsDir = join(ROOT, "dist-ts")
let copied = 0
for (const target of cleanupPaths) {
  const srcPath = join(ROOT, target)
  const relPath = target.replace(/^src\//, "")
  const distTsPath = join(distTsDir, relPath)
  if (existsSync(distTsPath)) {
    try {
      copyFileSync(distTsPath, srcPath)
      copied++
    } catch (error) {
      process.stderr.write(`[sync-ts-build] Failed to copy: ${distTsPath} -> ${srcPath}
`)
      throw error
    }
  }
}
console.log(`Synced ${copied} compiled JS artifacts to src/`)
