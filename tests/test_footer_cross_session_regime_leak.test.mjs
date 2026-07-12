// SPDX-License-Identifier: MIT
// Contract: the root of blackbox-state.json (sub_regime, cv, cascade_depth,
// etc.) is a process-global "whoever wrote last" mirror, NOT scoped to any
// particular session. With multiple concurrent OpenCode sessions, the footer
// must never fall back to that root snapshot as if it belonged to the
// CURRENT session -- doing so leaks another session's regime (e.g. a
// genuinely LOOPING session) into a session that is actually fine. Live-
// reproduced: a session correctly recorded as REFINING/not-looping in its own
// sessions[sid] record still painted "Looping" in the footer because the
// disk-state fallback read the file's root sub_regime instead.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cross-session-leak-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")

writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-flash",
  plugin: ["vibeOS"],
}))
writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "brain",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
  },
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-flash" },
    medium: { oc: "opencode-go/mimo-v2.5" },
    cheap: { oc: "opencode/big-pickle" },
  },
}))

const THIS_SESSION = "opencode-current-session"
const OTHER_SESSION = "opencode-other-looping-session"

writeFileSync(join(sandbox, ".claude", "blackbox-state.json"), JSON.stringify({
  enabled: true,
  // Root-level mirror left behind by whichever session last wrote to disk --
  // in this case, a genuinely LOOPING session that is NOT the current one.
  sub_regime: "LOOPING",
  is_looping: true,
  resolution: "looping",
  cascade_depth: 3,
  momentum: -0.4,
  n_interactions: 40,
  sessions: {
    [OTHER_SESSION]: {
      sub_regime: "LOOPING",
      is_looping: true,
      resolution: "looping",
      cascade_depth: 3,
    },
    [THIS_SESSION]: {
      sub_regime: "REFINING",
      is_looping: false,
      resolution: "unresolved",
      cascade_depth: 0,
    },
  },
}))

after(() => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})

test("footer must not leak another session's LOOPING regime via the root disk mirror", async () => {
  const state = await import("../src/lib/state.js")
  const footer = await import("../src/lib/hooks/footer.js")
  state.setCurrentSessionId(THIS_SESSION)

  const message = { text: "Refactored the auth module and the tests are passing now." }
  await footer._appendFooter({ args: { model: "deepseek/deepseek-v4-flash" } }, message)

  assert.ok(
    !/Looping/i.test(message.text),
    `footer must show THIS session's own REFINING regime, not another session's LOOPING via the root mirror: ${message.text.slice(-300)}`,
  )
})
