// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Single-instance guard — exactly one vibeOS module may register hooks per process.
//
// OpenCode merges the global ~/.opencode/opencode.json with every project-level
// opencode.json it finds, so a stale or hand-added `plugin[]` entry loads a SECOND
// physical copy of the bundle into the same process. Each copy carries its own module
// state, so both register the full hook set: two footers appended per turn, savings
// counted twice, duplicate cascade-audit and ledger rows. That corruption is silent —
// it reads as real data — which is exactly why it must be impossible rather than
// merely discouraged.
//
// The latch lives on globalThis so separate module instances can see each other; the
// module scope alone cannot. Keying on the module URL (not a bare boolean) lets the
// SAME module claim repeatedly, which OpenCode does legitimately — it calls the plugin
// factory once per project instance.

const OWNER_KEY = "__vibeOS_instance_owner"

// Identity is the module's PATH, not its raw URL. Tests deliberately cache-bust
// (`import("../src/index.js?case=" + Date.now())`) to get a fresh module instance per
// case; that is one physical file re-instantiated on purpose, not a second copy on
// disk. Stripping the query/hash keeps those working while still refusing a genuinely
// different file — which is the only shape that reaches a user.
function moduleIdentity(moduleUrl: string | null | undefined): string {
  const raw = String(moduleUrl || "").trim()
  if (!raw) return ""
  const cut = Math.min(
    ...[raw.indexOf("?"), raw.indexOf("#")].filter((i) => i >= 0).concat([raw.length]),
  )
  return raw.slice(0, cut)
}

export function instanceGuardDisabled(): boolean {
  return String(process.env.VIBEOS_SINGLE_INSTANCE_GUARD || "").trim().toLowerCase() === "off"
}

export function getInstanceOwner(): string {
  return String((globalThis as Record<string, unknown>)[OWNER_KEY] || "")
}

/**
 * Claim the right to register hooks for this module URL.
 * Returns true when this module owns the process, false when a different copy already does.
 * An empty URL neither claims nor blocks — a host that cannot report a module identity
 * must keep working rather than silently losing the plugin.
 */
export function claimInstance(moduleUrl: string | null | undefined): boolean {
  if (instanceGuardDisabled()) return true
  const url = moduleIdentity(moduleUrl)
  if (!url) return true
  const owner = getInstanceOwner()
  if (!owner) {
    ;(globalThis as Record<string, unknown>)[OWNER_KEY] = url
    return true
  }
  return owner === url
}

export function resetInstanceGuardForTest(): void {
  delete (globalThis as Record<string, unknown>)[OWNER_KEY]
}
