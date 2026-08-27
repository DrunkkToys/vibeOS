import { AsyncLocalStorage } from "node:async_hooks"
import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

export const USER_HOME = (() => {
  try {
    return homedir()
  } catch {
    return tmpdir()
  }
})()

type RuntimeHomeContext = { home?: string }

// `process.env.X = someUndefinedVar` stores the literal string "undefined", and
// tests that snapshot/restore these variables hit that every time the variable
// was unset to begin with. A home of "undefined" is a *relative* path, so every
// state write lands in a stray undefined/ directory under the process cwd (the
// repo root, when the suite runs). Treat those non-values as unset so the normal
// fallback chain applies. See tests/cascade_audit_path_safety.test.mjs.
function envPath(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return undefined
  // Every relative value is rejected, not just the two literals. A relative home is
  // resolved against whatever cwd each writer happens to have, so one string names as
  // many directories as there are working directories in the process tree, and the
  // state tree splits across them. "undefined" and "null" were only the two members of
  // that class we had seen; they are relative paths themselves, so this subsumes them.
  // Observed live 2026-08-27: VIBEOS_HOME=.ml-run2/trials/vibeqmax-0/home was seeded by
  // a harness running at the repo root and read by a plugin running in the trial
  // project dir, which found no model-tiers.json and silently ran the arm in budget
  // mode on the cheap model.
  if (!isAbsolute(trimmed)) return undefined
  return trimmed
}

const RUNTIME_HOME_CONTEXT = new AsyncLocalStorage<RuntimeHomeContext>()

export function resolveVibeOSHome(): string {
  return envPath(process.env.VIBEOS_HOME) || join(envPath(process.env.HOME) || USER_HOME, ".vibeos")
}

// Single global source of truth: OpenCode (CLI and desktop sidecar alike)
// treats ~/.opencode as the one and only default config/plugin home. Previously
// this scanned both ~/.opencode and the XDG ~/.config/opencode, which caused
// vibeOS to load twice in one process (duplicate MODULE_TYPELESS_PACKAGE_JSON
// warnings for two different vibeOS.js paths, confirmed live). Operator
// directive 2026-08-09: exactly one home, no exceptions. See
// scripts/lib/opencode-homes.mjs for the deploy-time counterpart.
export function resolveOpenCodeHomes(): string[] {
  const override = envPath(process.env.VIBEOS_OPENCODE_HOME) || envPath(process.env.OPENCODE_HOME)
  if (override) return [override]
  const base = envPath(process.env.HOME) || USER_HOME
  return [join(base, ".opencode")]
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
  return homes[0] || join(envPath(process.env.HOME) || USER_HOME, ".config", "opencode")
}

export function getVibeOSHome(): string {
  return envPath(process.env.VIBEOS_HOME) || envPath(RUNTIME_HOME_CONTEXT.getStore()?.home) || join(envPath(process.env.HOME) || USER_HOME, ".vibeos")
}

export function getOpenCodeHome(): string {
  return resolveOpenCodeHome()
}

export function getOpenCodeHomes(): string[] {
  return resolveOpenCodeHomes()
}

export function setVibeOSHomeContext(home: string): void {
  const resolved = envPath(home) || resolveVibeOSHome()
  try {
    process.env.VIBEOS_HOME = resolved
  } catch {}
  RUNTIME_HOME_CONTEXT.enterWith({ home: resolved })
}

export function resetRuntimePathsForTest(): void {
  RUNTIME_HOME_CONTEXT.enterWith({})
}
