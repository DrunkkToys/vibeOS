// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fe = await import("../flow-enforcer.js")
const st = await import("../../lib/state.js")

test("console-error guard persists [vibeOS] errors to session-events (not silently dropped)", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-guard-"))
  try {
    st.setVibeOSHomeContext(home)
    st.setCurrentSessionId("ses_guardtest")
    fe.resetAll()
    // Emit the exact kind of diagnostic the guard used to swallow entirely.
    console.error("[vibeOS] updateState failed after 3 retries: synthetic test failure")
    const eventsPath = join(home, "session-events", "ses_guardtest.jsonl")
    assert.ok(existsSync(eventsPath), "session-events file must exist")
    const raw = readFileSync(eventsPath, "utf8")
    assert.ok(raw.includes("footer-error"), "a footer-error event must be recorded")
    assert.ok(raw.includes("updateState failed after 3 retries"), "the failure message must be captured")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("console-error guard still forwards non-vibeOS errors to stderr", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-guard2-"))
  try {
    st.setVibeOSHomeContext(home)
    st.setCurrentSessionId("ses_guard2")
    fe.resetAll()
    const out = []
    const orig = console.error
    console.error = (...args) => { out.push(args.join(" ")) }
    try {
      console.error("some-unrelated-error-happened")
      assert.ok(out.length === 1, "non-vibeOS errors must reach stderr")
    } finally {
      console.error = orig
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
