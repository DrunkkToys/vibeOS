import { join } from "node:path"
import { homedir } from "node:os"

// Single global source of truth: OpenCode (CLI and desktop sidecar alike)
// treats ~/.opencode as the universal default config/plugin home — confirmed
// live (both the CLI bootstrap log and the desktop sidecar's plugin loader
// reference ~/.opencode/opencode.json and ~/.opencode/plugins/vibeOS.js for
// every open project). Previously this spread the plugin registration across
// the desktop app's own profile dir, ~/.config/opencode, AND every directory
// up the tree from cwd that happened to already contain an opencode.json —
// which meant a single project could load 2-3 separate vibeOS module
// instances in the SAME OpenCode process (confirmed via duplicate
// MODULE_TYPELESS_PACKAGE_JSON warnings for two different vibeOS.js paths in
// one server run). One registration, one loaded instance, no exceptions.
export function resolveOpenCodeHomes({ home = homedir() } = {}) {
  const override = process.env.VIBEOS_OPENCODE_HOME
  if (override) return [override]
  return [join(home, ".opencode")]
}

export function resolveOpenCodeHome(opts = {}) {
  return resolveOpenCodeHomes(opts)[0]
}
