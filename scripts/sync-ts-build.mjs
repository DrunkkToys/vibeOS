import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

// Build the list of lib modules to sync
const libModules = [
  "api-client", "pricing", "state", "turn-classify", "tdd-enforcer",
  "index-helpers", "research-audit", "reporting", "credit-api", "selection-manager",
  "trinity-rebuild", "trinity-tool",
]

const hookModules = [
  "footer", "tool-execute", "chat-transform", "session-compact", "shell-env",
]

const syncPairs = []
for (const mod of libModules) {
  syncPairs.push({ from: join("dist-ts", "lib", `${mod}.js`), to: join("src", "lib", `${mod}.js`) })
}
for (const mod of hookModules) {
  syncPairs.push({ from: join("dist-ts", "lib", "hooks", `${mod}.js`), to: join("src", "lib", "hooks", `${mod}.js`) })
}

const mappings = [
  ...syncPairs,
  {
    from: join("dist-ts", "index.js"),
    to: join("src", "index.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "flow-enforcer.js"),
    to: join("src", "vibeOS-lib", "flow-enforcer.js"),
  },
  {
    from: join("dist-ts", "flow-enforcer.js"),
    to: join("src", "flow-enforcer.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "session-metrics.js"),
    to: join("src", "vibeOS-lib", "session-metrics.js"),
  },
  {
    from: join("dist-ts", "utils", "cost-formatter.js"),
    to: join("src", "utils", "cost-formatter.js"),
  },
  {
    from: join("dist-ts", "utils", "timer.js"),
    to: join("src", "utils", "timer.js"),
  },
  {
    from: join("dist-ts", "utils", "math.js"),
    to: join("src", "utils", "math.js"),
  },
  {
    from: join("dist-ts", "vibeOS-mcp-server.js"),
    to: join("src", "vibeOS-mcp-server.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "index.js"),
    to: join("src", "vibeOS-lib", "blackbox", "index.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "advice-layer.js"),
    to: join("src", "vibeOS-lib", "blackbox", "advice-layer.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "crew-constants.js"),
    to: join("src", "vibeOS-lib", "blackbox", "crew-constants.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "exposure-model.js"),
    to: join("src", "vibeOS-lib", "blackbox", "exposure-model.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "resolution-tracker.js"),
    to: join("src", "vibeOS-lib", "blackbox", "resolution-tracker.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "taxonomy.js"),
    to: join("src", "vibeOS-lib", "blackbox", "taxonomy.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "meta-controller.js"),
    to: join("src", "vibeOS-lib", "blackbox", "meta-controller.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "ml-router.js"),
    to: join("src", "vibeOS-lib", "ml-router.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "smart-cache.js"),
    to: join("src", "vibeOS-lib", "smart-cache.js"),
  },
  {
    from: join("dist-ts", "vibeOS-lib", "blackbox", "local-stub.js"),
    to: join("src", "vibeOS-lib", "blackbox", "local-stub.js"),
  },
  {
    from: join("dist-ts", "vibeOS-api-server", "client.js"),
    to: join("src", "vibeOS-api-server", "client.js"),
  },
]

for (const { from, to } of mappings) {
  if (!existsSync(from)) {
    throw new Error(`Missing build output: ${from}`)
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

console.log("Synced TS build outputs into src/")
