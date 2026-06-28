// SPDX-License-Identifier: MIT
// recordSessionBridge wrote a job record then immediately removed it, leaving no
// durable artifact: there was no .session-bridges.jsonl and no loader, so a
// bridge's carry_forward/prompt_prefix never survived to the next session. This
// pins durable append + load-latest-by-project.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-bridge-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

const sb = await import("../src/lib/session-bridge.js?bridge=" + Date.now())
const bridgesFile = join(sandbox, ".claude", ".session-bridges.jsonl")

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

function bridge(id, fp, carry) {
  return {
    bridge_id: id,
    bridge_key: id,
    session_id: "sess-" + id,
    project_fingerprint: fp,
    from_tier: "cheap",
    to_tier: "medium",
    carry_forward: carry,
    prompt_prefix: "PREFIX:" + carry,
    tags: ["t"],
  }
}

test("[bridge] recordSessionBridge appends to .session-bridges.jsonl", () => {
  const ok = sb.recordSessionBridge(bridge("b1", "fp-A", "first"))
  assert.equal(ok, true)
  assert.ok(existsSync(bridgesFile), ".session-bridges.jsonl must exist")
})

test("[bridge] loadLatestSessionBridge returns the most recent for a fingerprint", () => {
  sb.recordSessionBridge(bridge("b2", "fp-A", "second"))
  sb.recordSessionBridge(bridge("b3", "fp-B", "other-project"))
  const latestA = sb.loadLatestSessionBridge("fp-A")
  assert.ok(latestA, "a bridge for fp-A should be found")
  assert.equal(latestA.carry_forward, "second", "must return the latest fp-A bridge")
  const latestB = sb.loadLatestSessionBridge("fp-B")
  assert.equal(latestB.carry_forward, "other-project")
  assert.equal(sb.loadLatestSessionBridge("fp-missing"), null, "unknown fingerprint -> null")
})
