import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const mappings = [
  {
    from: join("dist-ts", "theSaver-lib", "flow-enforcer.js"),
    to: join("src", "theSaver-lib", "flow-enforcer.js"),
  },
  {
    from: join("dist-ts", "flow-enforcer.js"),
    to: join("src", "flow-enforcer.js"),
  },
  {
    from: join("dist-ts", "theSaver-lib", "session-metrics.js"),
    to: join("src", "theSaver-lib", "session-metrics.js"),
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
]

for (const { from, to } of mappings) {
  if (!existsSync(from)) {
    throw new Error(`Missing build output: ${from}`)
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

console.log("Synced TS build outputs into src/")
