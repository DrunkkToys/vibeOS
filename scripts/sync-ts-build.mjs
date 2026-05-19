import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const mappings = [
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
]

for (const { from, to } of mappings) {
  if (!existsSync(from)) {
    throw new Error(`Missing build output: ${from}`)
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

console.log("Synced TS build outputs into src/")
