// SPDX-License-Identifier: MIT
// Contract: the footer must display the freshly-computed live sub_regime for
// the current turn, not a stale disk snapshot from an earlier point in the
// session. resolveFooterDisplayState() prefers diskBlackboxState over
// liveBlackboxState whenever diskCascadeDepth > liveCascadeDepth -- but a
// session's recorded cascade_depth can legitimately be higher on disk from an
// earlier, more complex turn even though the CURRENT turn correctly resolved
// to a lower-depth, non-looping regime. When that happens the footer must not
// regress to showing the stale disk regime (e.g. "Looping") for the live turn.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-footer-stale-disk-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME

function setup() {
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
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
  // Stale disk snapshot: an earlier turn escalated deep into the cascade and
  // was (correctly, at the time) classified as LOOPING.
  writeFileSync(join(sandbox, ".claude", "blackbox-state.json"), JSON.stringify({
    enabled: true,
    sub_regime: "LOOPING",
    is_looping: true,
    resolution: "looping",
    cascade_depth: 3,
    momentum: -0.4,
    n_interactions: 5,
    sessions: {},
  }))
}

test("footer shows the live turn's regime, not a stale higher-cascade-depth disk snapshot", async () => {
  setup()
  const turn = await import("../src/lib/turn-classify.js")
  const footer = await import("../src/lib/hooks/footer.js")

  // The CURRENT turn correctly resolved to REFINING / not looping, at a
  // lower cascade depth than what's still sitting on disk from earlier.
  turn.setLatestBlackboxState({
    enabled: true,
    sub_regime: "REFINING",
    is_looping: false,
    resolution: "converging",
    cascade_depth: 0,
    momentum: 0.3,
    n_interactions: 6,
    sessions: {},
  })

  const message = { text: "Refactored the auth module and the tests are passing now." }
  await footer._appendFooter({ args: { model: "deepseek/deepseek-v4-flash" } }, message)

  assert.ok(
    !/Looping/i.test(message.text),
    `footer must not show the stale disk LOOPING regime for a turn that live-resolved to REFINING: ${message.text.slice(-300)}`,
  )
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
