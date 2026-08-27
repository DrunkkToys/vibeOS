// SPDX-License-Identifier: MIT
// A stringified `undefined` must never become the state root.
//
// runtime-paths.ts rejects the literal strings "undefined"/"null" everywhere it
// reads a home (envPath), but state.ts's setVibeOSHomeContext kept its own
// looser copy: `String(home || "").trim() || resolveVibeOSHome()`. The string
// "undefined" is truthy, so it survived that check and syncVibeOSPathBindings
// rebound every state file path to `undefined/...` — resolved relative to the
// user's project directory. Observed live: an `undefined/session-events/` tree
// written into the repo working tree on 2026-08-26, by the one session-events
// writer that reads state.ts's VIBEOS_HOME binding directly
// (vibeOS-lib/semantic-observer.ts) rather than calling getVibeOSHome().
//
// getVibeOSHome() alone never showed the bug: it delegates to runtime-paths,
// whose envPath rejected the same value. So the two resolvers silently
// disagreed — getVibeOSHome() pointed at the real home while every exported
// file-path binding pointed at ./undefined. This pins both.
import { test } from "node:test"
import assert from "node:assert/strict"

const state = await import("../src/lib/state.js")

const prevEnv = process.env.VIBEOS_HOME
const realHome = state.getVibeOSHome()

test.after(() => {
  if (prevEnv === undefined) delete process.env.VIBEOS_HOME
  else process.env.VIBEOS_HOME = prevEnv
  state.setVibeOSHomeContext(realHome)
})

for (const poison of ["undefined", "null", "  undefined  ", ""]) {
  test(`setVibeOSHomeContext(${JSON.stringify(poison)}) does not root state at it`, () => {
    state.setVibeOSHomeContext(poison)

    const home = state.getVibeOSHome()
    assert.ok(home.startsWith("/"), `home must be absolute, got ${JSON.stringify(home)}`)

    // The exported path bindings are the surface that actually leaked.
    for (const key of ["VIBEOS_HOME", "TIERS_FILE"]) {
      const value = String(state[key])
      assert.ok(
        value.startsWith("/"),
        `${key} must be an absolute path, got ${JSON.stringify(value)}`,
      )
      assert.ok(
        !/^\.?\/?(undefined|null)\b/.test(value),
        `${key} must not be rooted at a stringified ${poison.trim() || "empty"}, got ${value}`,
      )
    }

    // ...and the two resolvers must agree, or writers disagree by which one
    // they happen to call.
    assert.equal(String(state.VIBEOS_HOME), home, "VIBEOS_HOME binding must match getVibeOSHome()")
    assert.notEqual(process.env.VIBEOS_HOME, "undefined")
    assert.notEqual(process.env.VIBEOS_HOME, "null")
  })
}

test("a real home is still honoured", () => {
  state.setVibeOSHomeContext("/tmp/vibeos-home-guard-check")
  assert.equal(state.getVibeOSHome(), "/tmp/vibeos-home-guard-check")
  assert.equal(String(state.VIBEOS_HOME), "/tmp/vibeos-home-guard-check")
  assert.equal(String(state.TIERS_FILE), "/tmp/vibeos-home-guard-check/model-tiers.json")
})
