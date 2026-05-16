import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const mappings = [
  {
    from: join("dist-ts", "theSaver-lib", "flow-enforcer.js"),
    to: join("src", "theSaver-lib", "flow-enforcer.js"),
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
