// SPDX-License-Identifier: MIT
// Contract: setCurrentSessionId() must keep the scratchpad cache's session
// scoping (getOcSessionId, read by scratchpad-cache.ts's getSessionRoot()) in
// sync with the real conversation identity. Without this, getCurrentSessionId()
// (used by footer/blackbox) can correctly track OpenCode's real per-conversation
// sessionID while the scratchpad/smart-cache subsystem stays pinned to the
// stale per-process placeholder set once at plugin init -- so cache entries
// get written under the wrong session directory and repeat reads across a
// real conversation never register as hits.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-scratchpad-sid-sync-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")

test("setCurrentSessionId propagates to the scratchpad cache's session id", async () => {
  const state = await import("../src/lib/state.js")
  const runtimeState = await import("../src/lib/runtime-state.js")
  const scratchpad = await import("../src/lib/state/scratchpad-cache.js")

  state.setCurrentSessionId("ses_realConversationABC")

  assert.equal(state.getCurrentSessionId(), "ses_realConversationABC")
  assert.equal(runtimeState.getOcSessionId(), "ses_realConversationABC", "scratchpad session id must follow the real conversation id")
  assert.ok(
    scratchpad.getSessionRoot().endsWith(join("sessions", "ses_realConversationABC")),
    `scratchpad session root must be scoped to the real session: ${scratchpad.getSessionRoot()}`,
  )
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
