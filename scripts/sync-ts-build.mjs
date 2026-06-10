import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// Build the list of lib modules to sync
const libModules = [
  "api-client", "pricing", "state", "turn-classify", "tdd-enforcer",
  "index-helpers", "research-audit", "reporting", "credit-api", "selection-manager",
  "runtime-surface", "classifiers",
  "mode-router", "trinity-rebuild", "trinity-tool",
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
  join("src", "utils", "fs-helpers.js"),
  join("src", "vibeOS-lib", "ml-router.js"),
  join("src", "vibeOS-lib", "smart-cache.js"),
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
