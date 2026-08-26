// SPDX-License-Identifier: MIT
// Shared diagnostic for the Task-routing suites.
//
// These suites drive the real onToolExecuteBefore hook and assert the model it
// puts on the task args. When that comes back null the assertion alone cannot
// say why -- the hook resolves models from pricing's TRINITY_* globals, reads
// selection state from $VIBEOS_HOME/model-tiers.json, and writes an audit row
// only if it reached the routing section. This dumps all three so a failure
// names its cause instead of just reporting null.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function routeDiag(extra = {}) {
  const home = process.env.VIBEOS_HOME || "(unset)"
  const tiersPath = join(home, "model-tiers.json")
  const out = {
    ...extra,
    node: process.version,
    platform: process.platform,
    HOME: process.env.HOME || "(unset)",
    VIBEOS_HOME: home,
    tiers_exists: existsSync(tiersPath),
  }
  try {
    const pricing = require_pricing()
    out.TRINITY = {
      cheap: pricing.TRINITY_CHEAP,
      medium: pricing.TRINITY_MEDIUM,
      brain: pricing.TRINITY_BRAIN,
    }
  } catch (err) {
    out.TRINITY = `unavailable: ${err.message}`
  }
  if (out.tiers_exists) {
    try {
      const raw = JSON.parse(readFileSync(tiersPath, "utf8"))
      out.selection_on_disk = raw.selection
      out.trinity_on_disk = raw.trinity
    } catch (err) {
      out.selection_on_disk = `unreadable: ${err.message}`
    }
  }
  const audit = join(home, "cascade-audit", "cascade-audit.jsonl")
  out.audit_exists = existsSync(audit)
  if (out.audit_exists) {
    try {
      const lines = readFileSync(audit, "utf8").trim().split("\n").filter(Boolean)
      out.audit_count = lines.length
      out.audit_last = lines[lines.length - 1]
    } catch (err) {
      out.audit_last = `unreadable: ${err.message}`
    }
  }
  return JSON.stringify(out, null, 2)
}

// Resolved lazily and cached so importing this module never pulls in the
// runtime for suites that only need it on failure.
let _pricing = null
function require_pricing() {
  if (_pricing) return _pricing
  throw new Error("call setPricing() from the suite before using routeDiag")
}

export function setPricing(mod) {
  _pricing = mod
}
