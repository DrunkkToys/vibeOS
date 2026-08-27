// SPDX-License-Identifier: MIT
// A relative VIBEOS_HOME must never become the state root.
//
// envPath rejected the literal strings "undefined"/"null", but those are only two
// members of the class that actually breaks: every relative path. A relative home is
// resolved against whatever cwd each writer happens to have, so one string names as
// many directories as there are working directories in the process tree.
//
// Observed live 2026-08-27 on the .ml-run2 A/B: the harness exported
// VIBEOS_HOME=.ml-run2/trials/vibeqmax-0/home and seeded model-tiers.json there, but
// the plugin ran with cwd = the trial project dir and resolved the same string to
// <proj>/.ml-run2/trials/vibeqmax-0/home. It found no model-tiers.json, fell back to
// built-in defaults, and ran the vibeqmax arm in budget mode on the cheap model --
// control-sync recorded optimizationMode "budget" / workerSlot "cheap" instead of
// "vibeqmax" / "brain", and authoritative was false. The whole state tree was written
// into the project directory while the seeded configuration sat unread next door.
//
// Rejecting relative values makes the fallback the real home, which is the same
// treatment "undefined"/"null" already get -- they are themselves relative paths.
import { test } from "node:test"
import assert from "node:assert/strict"
import { isAbsolute } from "node:path"

const rp = await import("../src/lib/runtime-paths.js")
const state = await import("../src/lib/state.js")

const prevEnv = process.env.VIBEOS_HOME
const realHome = state.getVibeOSHome()

test.after(() => {
  if (prevEnv === undefined) delete process.env.VIBEOS_HOME
  else process.env.VIBEOS_HOME = prevEnv
  state.setVibeOSHomeContext(realHome)
})

const RELATIVE = [".ml-run2/trials/vibeqmax-0/home", "undefined", "null", "state", "./x", "../y"]

for (const value of RELATIVE) {
  test(`resolveVibeOSHome rejects relative VIBEOS_HOME ${JSON.stringify(value)}`, () => {
    process.env.VIBEOS_HOME = value
    const home = rp.resolveVibeOSHome()
    assert.ok(isAbsolute(home), `resolveVibeOSHome returned a relative path: ${home}`)
    assert.ok(!home.includes(value) || isAbsolute(value), `relative value leaked into ${home}`)
  })

  test(`getVibeOSHome rejects relative VIBEOS_HOME ${JSON.stringify(value)}`, () => {
    process.env.VIBEOS_HOME = value
    assert.ok(isAbsolute(rp.getVibeOSHome()), "getVibeOSHome must return an absolute path")
  })

  test(`both resolvers agree for ${JSON.stringify(value)}`, () => {
    process.env.VIBEOS_HOME = value
    state.setVibeOSHomeContext(value)
    // The split that caused the leak: state.ts's bindings pointing somewhere other
    // than the home getVibeOSHome() reports.
    assert.equal(state.getVibeOSHome(), rp.resolveVibeOSHome())
    assert.ok(isAbsolute(state.getVibeOSHome()))
  })
}

test("an absolute VIBEOS_HOME is still honoured", () => {
  const abs = "/tmp/vibeos-abs-home-test"
  process.env.VIBEOS_HOME = abs
  assert.equal(rp.resolveVibeOSHome(), abs)
  assert.equal(rp.getVibeOSHome(), abs)
  state.setVibeOSHomeContext(abs)
  assert.equal(state.getVibeOSHome(), abs)
})
