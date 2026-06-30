import { AsyncLocalStorage } from "node:async_hooks"
import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export const USER_HOME = (() => {
  try {
    return homedir()
  } catch {
    return tmpdir()
  }
})()

type RuntimeHomeContext = { home?: string }

const RUNTIME_HOME_CONTEXT = new AsyncLocalStorage<RuntimeHomeContext>()

export function resolveVibeOSHome(): string {
  return process.env.VIBEOS_HOME || join(process.env.HOME || USER_HOME, ".claude")
}

export function resolveOpenCodeHomes(): string[] {
  const override = process.env.VIBEOS_OPENCODE_HOME || process.env.OPENCODE_HOME
  if (override) return [override]
  const base = process.env.HOME || USER_HOME
  const homes = [join(base, ".opencode")]
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(base, ".config")
  const xdgOpenCode = join(xdgConfig, "opencode")
  if (xdgOpenCode !== homes[0]) homes.push(xdgOpenCode)
  return homes
}

function hasOpenCodeConfig(dir: string): boolean {
  return existsSync(join(dir, "opencode.json")) || existsSync(join(dir, "opencode.jsonc"))
}

export function resolveOpenCodeHome(): string {
  const homes = resolveOpenCodeHomes()
  for (const home of homes) {
    if (hasOpenCodeConfig(home)) return home
  }
  for (const home of homes) {
    if (existsSync(home)) return home
  }
  return homes[0] || join(process.env.HOME || USER_HOME, ".config", "opencode")
}

export function getVibeOSHome(): string {
  return process.env.VIBEOS_HOME || RUNTIME_HOME_CONTEXT.getStore()?.home || join(process.env.HOME || "", ".claude")
}

export function getOpenCodeHome(): string {
  return resolveOpenCodeHome()
}

export function getOpenCodeHomes(): string[] {
  return resolveOpenCodeHomes()
}

export function setVibeOSHomeContext(home: string): void {
  const resolved = String(home || "").trim() || resolveVibeOSHome()
  try {
    process.env.VIBEOS_HOME = resolved
  } catch {}
  RUNTIME_HOME_CONTEXT.enterWith({ home: resolved })
}

export function resetRuntimePathsForTest(): void {
  RUNTIME_HOME_CONTEXT.enterWith({})
}
