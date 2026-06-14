import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

function hasOpenCodeConfig(dir) {
  return existsSync(join(dir, "opencode.json")) || existsSync(join(dir, "opencode.jsonc"))
}

function collectWorkspaceOpenCodeHomes(cwd) {
  const homes = []
  const seen = new Set()
  let dir = resolve(cwd || process.cwd())
  while (true) {
    for (const candidate of [dir, join(dir, "opencode"), join(dir, ".opencode")]) {
      if (seen.has(candidate)) continue
      if (hasOpenCodeConfig(candidate)) {
        seen.add(candidate)
        homes.push(candidate)
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return homes
}

function collectHomeOpenCodeHomes(baseHome) {
  const home = baseHome || homedir()
  const desktopHome = process.env.VIBEOS_OPENCODE_DESKTOP_HOME
    || (process.platform === "darwin" ? join(home, "Library", "Application Support", "ai.opencode.desktop") : null)
  return [desktopHome, join(home, ".config", "opencode"), join(home, ".opencode")].filter(Boolean)
}

export function resolveOpenCodeHomes({ cwd = process.cwd(), home = homedir() } = {}) {
  const override = process.env.VIBEOS_OPENCODE_HOME
  if (override) return [override]

  const workspaceHomes = collectWorkspaceOpenCodeHomes(cwd)
  const homeHomes = collectHomeOpenCodeHomes(home)
  const activeHomeHomes = homeHomes.filter((dir) => existsSync(dir))

  const homeCandidates = activeHomeHomes.length > 0 ? activeHomeHomes : homeHomes
  const seen = new Set()
  return [...workspaceHomes, ...homeCandidates].filter((dir) => {
    if (dir == null) return false
    if (seen.has(dir)) return false
    seen.add(dir)
    return true
  })
}

export function resolveOpenCodeHome(opts = {}) {
  const homes = resolveOpenCodeHomes(opts)
  return homes[0] || join(opts.home || homedir(), ".config", "opencode")
}
