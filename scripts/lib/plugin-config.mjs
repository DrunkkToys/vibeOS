import { existsSync } from "node:fs"
import { resolve } from "node:path"

export function resolveVibeOSPluginRef(home) {
  return resolve(home, "plugins", "vibeOS.js")
}

export function normalizeVibeOSPluginRefs(pluginList, canonicalPluginRef) {
  const refs = Array.isArray(pluginList) ? pluginList : []
  const kept = []
  let hasCanonical = false

  for (const ref of refs) {
    if (typeof ref !== "string") {
      kept.push(ref)
      continue
    }
    if (!ref.includes("vibeOS")) {
      kept.push(ref)
      continue
    }
    const normalized = resolve(ref)
    if (normalized === canonicalPluginRef || ref === canonicalPluginRef) {
      if (!hasCanonical) {
        hasCanonical = true
        kept.push(canonicalPluginRef)
      }
      continue
    }
    if (existsSync(normalized)) continue
  }

  if (!hasCanonical) kept.push(canonicalPluginRef)
  return kept
}
