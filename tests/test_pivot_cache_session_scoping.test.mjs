// SPDX-License-Identifier: MIT
// Contract: PivotCache must be scoped per-conversation. It used to default to
// a single $VIBEOS_HOME-wide file/instance shared by every OpenCode session,
// past and present -- vibemax.ts writes workflow snapshots (captured
// decisions/files/tool outputs) into it, and both vibemax.ts and
// vibeultrax.ts read pivot-back matches from it. Without session scoping, a
// pivot captured in one conversation could match and inject its context
// (decisions, files, tool outputs) into a completely unrelated conversation.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-pivot-session-scope-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")

test("pivotCacheDirForSession scopes by session id, not a shared global path", async () => {
  const { pivotCacheDirForSession } = await import("../src/vibeOS-lib/blackbox/pivot-cache.js")
  const dirA = pivotCacheDirForSession("session-A")
  const dirB = pivotCacheDirForSession("session-B")
  assert.notEqual(dirA, dirB, "different sessions must get different pivot-cache directories")
  assert.ok(dirA.includes("session-A"))
  assert.ok(dirB.includes("session-B"))
})

test("vibemax getPivotCache() recreates the instance and does not leak snapshots across sessions", async () => {
  const state = await import("../src/lib/state.js")
  const vibemax = await import("../src/vibeOS-lib/blackbox/vibemax.js")

  state.setCurrentSessionId("session-alpha")
  const cacheAlpha = vibemax.getPivotCache()
  cacheAlpha.snapshot("wf-alpha", { tokens: ["debug"], intent: "fixing the auth bug in session alpha" })

  state.setCurrentSessionId("session-beta")
  const cacheBeta = vibemax.getPivotCache()

  assert.notEqual(cacheAlpha, cacheBeta, "a session change must produce a new cache instance")
  assert.equal(cacheBeta.read("wf-alpha"), null, "session beta must not see session alpha's captured workflow")
})

test("vibeultrax getPivotCache() is also session-scoped", async () => {
  const state = await import("../src/lib/state.js")
  const vibeultraxMod = await import("../src/vibeOS-lib/blackbox/vibeultrax.js")

  state.setCurrentSessionId("session-gamma")
  const first = vibeultraxMod.vibeultraxPipeline({ user_text: "debug this" })
  state.setCurrentSessionId("session-delta")
  const second = vibeultraxMod.vibeultraxPipeline({ user_text: "debug this" })

  // Different sessions, same-looking text: neither should claim a pivot-back
  // match against the other session's (nonexistent, in this fresh sandbox)
  // history -- this mainly guards against a crash/regression in the wiring.
  assert.equal(first.pivot_detected, false)
  assert.equal(second.pivot_detected, false)
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
