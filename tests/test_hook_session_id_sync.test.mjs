// SPDX-License-Identifier: MIT
// Contract: OpenCode supplies a real, per-conversation `sessionID` in the
// input of several hooks (tool.execute.before/after, experimental.text.complete,
// experimental.session.compacting, experimental.chat.system.transform,
// chat.params -- per @opencode-ai/plugin's Hooks type). The plugin must sync
// its own session identity to that value so that separate OpenCode chat
// tabs/conversations running within the same Desktop app process each get
// their own vibeOS session record, instead of all sharing whichever session
// id DelegationEnforcer happened to generate once at plugin init. Without
// this, a brand-new conversation silently inherits an older conversation's
// entire accumulated blackbox state (regime, loop count, reward history) --
// live-reproduced as a fresh "New session" chat immediately showing LOOPING.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-hook-session-sync-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-flash",
  plugin: ["vibeOS"],
}))
writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "brain", optimization_mode: "vibeultrax" },
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-flash" },
    medium: { oc: "opencode-go/mimo-v2.5" },
    cheap: { oc: "opencode/big-pickle" },
  },
}))

after(() => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})

test("hooks sync the plugin's session identity to OpenCode's real per-conversation sessionID", async () => {
  const { DelegationEnforcer } = await import("../src/index.js")
  const state = await import("../src/lib/state.js")

  const hooks = await DelegationEnforcer({ client: {}, directory: sandbox })

  await hooks["tool.execute.before"]({ tool: "read", sessionID: "opencode-session-AAA", callID: "c1" }, { args: {} })
  assert.equal(state.getCurrentSessionId(), "opencode-session-AAA", "tool.execute.before must adopt OpenCode's real sessionID")

  await hooks["tool.execute.before"]({ tool: "read", sessionID: "opencode-session-BBB", callID: "c2" }, { args: {} })
  assert.equal(state.getCurrentSessionId(), "opencode-session-BBB", "a different conversation's sessionID must actually switch the active session")

  await hooks["experimental.text.complete"]({ sessionID: "opencode-session-CCC", messageID: "m1", partID: "p1" }, { text: "A sufficiently long response to satisfy the footer painting threshold for this test." })
  assert.equal(state.getCurrentSessionId(), "opencode-session-CCC", "experimental.text.complete must adopt OpenCode's real sessionID")
})
