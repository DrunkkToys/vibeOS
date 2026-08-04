// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fe = await import("../flow-enforcer.js")
const st = await import("../../lib/state.js")

test("flow warn persists through the locked writer and preserves existing state", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-f3-"))
  try {
    st.setVibeOSHomeContext(home)
    writeFileSync(join(home, "delegation-state.json"), JSON.stringify({
      lifetime: { total_savings_usd: 12.34, cache_savings_usd: 0, missed_context7_usd: 0 },
      sessions: {},
    }) + "\n")
    fe.resetForTest([{
      id: "f3-test",
      trigger: "Edit",
      pattern: "TODO",
      severity: "warn",
      description: "test",
    }])
    fe.checkFlowRules({ tool: "Edit", filePath: "src/a.js", content: "// TODO fix" })
    const state = JSON.parse(readFileSync(join(home, "delegation-state.json"), "utf-8"))
    assert.equal(state.lifetime.total_savings_usd, 12.34, "existing lifetime must be preserved")
    const warn = (state.flow_warns || []).find((w) => w.rule_id === "f3-test")
    assert.ok(warn, "flow warn must be recorded")
    assert.equal(warn.filePath, "src/a.js")
    assert.ok(warn.sid, "warn carries a session/pid id")
  } finally {
    fe.resetAll()
    rmSync(home, { recursive: true, force: true })
  }
})

test("flow warn write leaves no temp files behind (atomic path)", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-f3b-"))
  try {
    st.setVibeOSHomeContext(home)
    fe.resetForTest([{
      id: "f3-atomic",
      trigger: "Edit",
      pattern: "HACK",
      severity: "warn",
      description: "test",
    }])
    fe.checkFlowRules({ tool: "Edit", filePath: "src/b.js", content: "// HACK" })
    const leftovers = readdirSync(home).filter((f) => f.includes(".tmp"))
    assert.equal(leftovers.length, 0, `no temp files left: ${leftovers.join(",")}`)
  } finally {
    fe.resetAll()
    rmSync(home, { recursive: true, force: true })
  }
})
