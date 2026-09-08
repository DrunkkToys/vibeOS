// SPDX-License-Identifier: MIT
// Contract: a lock failure and a callback failure are different failures.
//
// withFileLock wrapped `openSync(lockPath,"wx")` AND `fn()` in one try/catch,
// so anything the callback threw was indistinguishable from contention: the
// busy-loop swallowed it, retried the same deterministic error every 10ms for
// the full 2000ms timeout, and then threw "lock not acquired" -- naming a cause
// that had not occurred and discarding the one that had.
//
// Measured on this tree before the fix, single process, empty lock directory:
//   writeSelection("active_slot","brain") with no model-tiers.json on disk
//   -> false, in 2009ms, reporting "lock not acquired after 2000ms".
// The real error was ENOENT from readFileSync. Past A/B run logs carry 572 of
// those lines for model-tiers.json and 222 for delegation-state.json; through
// updateState's own 3x retry each one costs ~6s and drops the write.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"

const { withFileLock, FILE_LOCK_DIR } = await import("../src/lib/state.js")

const lockPathFor = (filePath) =>
  join(FILE_LOCK_DIR, createHash("sha1").update(String(filePath || "")).digest("hex") + ".lock")

test("a throwing callback surfaces its own error, immediately", () => {
  const path = join(tmpdir(), "vibeos-lock-real-error-" + Date.now() + "-" + Math.random())
  const started = Date.now()
  assert.throws(
    () => withFileLock(path, () => { throw new Error("ENOENT: no such file") }, { timeoutMs: 2000 }),
    /ENOENT: no such file/,
    "the callback's own error must be what the caller sees",
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 500, `must fail fast, not burn the lock timeout (took ${elapsed}ms)`)
  assert.equal(existsSync(lockPathFor(path)), false, "the lock file must still be released")
})

test("real contention still reports contention", () => {
  const path = join(tmpdir(), "vibeos-lock-contended-" + Date.now() + "-" + Math.random())
  mkdirSync(FILE_LOCK_DIR, { recursive: true })
  writeFileSync(lockPathFor(path), process.pid + "\n" + Date.now() + "\n")
  try {
    assert.throws(
      () => withFileLock(path, () => "never runs", { timeoutMs: 150, staleMs: 60_000 }),
      /lock not acquired/,
      "a genuinely held lock must still be reported as a lock failure",
    )
  } finally {
    try { require("node:fs").rmSync(lockPathFor(path), { force: true }) } catch {}
  }
})

test("writeSelection works on a home that has no model-tiers.json yet", async () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-fresh-home-"))
  const prevHome = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = home
  try {
    const sm = await import("../src/lib/selection-manager.js")
    const started = Date.now()
    const ok = sm.writeSelection("active_slot", "brain")
    const elapsed = Date.now() - started
    assert.equal(ok, true, "a first write on a fresh install must not be dropped")
    assert.ok(elapsed < 500, `must not burn the lock timeout (took ${elapsed}ms)`)
    const written = JSON.parse(readFileSync(join(home, "model-tiers.json"), "utf8"))
    assert.equal(written.selection.active_slot, "brain")
  } finally {
    if (prevHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevHome
  }
})
