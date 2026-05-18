import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let sandbox
before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "delegation-prod-reg-"))
  mkdirSync(join(sandbox, ".claude/scratch"), { recursive: true })
  process.env.HOME = sandbox
})

beforeEach(() => {
  rmSync(join(sandbox, ".claude/model-tiers.json"), { force: true })
  rmSync(join(sandbox, ".claude/delegation-state.json"), { force: true })
  rmSync(join(sandbox, ".claude/global-learning.json"), { force: true })
  rmSync(join(sandbox, ".claude/reports"), { recursive: true, force: true })
  rmSync(join(sandbox, ".claude/savings-ledger.jsonl"), { force: true })
  delete process.env.CLAUDE_CREDIT_PERCENT
})

after(() => rmSync(sandbox, { recursive: true, force: true }))

async function loadPlugin() {
  return import("../src/index.js?t=" + Date.now())
}

function seedTierFile() {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain: { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: false },
    tiers: {
      high: { regex: "opus" },
      mid: { regex: "sonnet|flash" },
      budget: { regex: ".*" },
    },
  }))
}

test("warn aggregation merges repeated events but keeps lifetime accounting", async () => {
  seedTierFile()
  process.env.CLAUDE_CREDIT_PERCENT = "25"

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-reg-1")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "scan logs" } })
  await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "scan logs" } })

  const state = JSON.parse(readFileSync(join(sandbox, ".claude/delegation-state.json"), "utf-8"))
  const sid = Object.keys(state.sessions)[0]
  const warns = state.sessions[sid].warns
  assert.equal(state.lifetime.warn_count, 2, "lifetime warn_count should still count both events")
  assert.equal(warns.length, 1, "session warns should merge repeated entries within dedupe window")
  assert.equal(warns[0].count, 2, "merged warn should preserve event count")
  assert.ok(warns[0].est_savings_usd > 0.01, "merged warn should accumulate savings")
})

test("non-task operations contribute to global learning", async () => {
  seedTierFile()
  process.env.CLAUDE_CREDIT_PERCENT = "25"

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-reg-2")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "check deployment health" } })

  const glFile = join(sandbox, ".claude/global-learning.json")
  assert.ok(existsSync(glFile), "global learning file should be created from non-task signal")
  const gl = JSON.parse(readFileSync(glFile, "utf-8"))
  assert.ok(gl.task_first_words?.check?.total >= 1, "first word should be learned from bash command")
})

test("auto session report uses semantic metrics fields for delegation count and savings", async () => {
  seedTierFile()
  process.env.CLAUDE_CREDIT_PERCENT = "25"

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-reg-3")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const taskArgs = { model: null, prompt: "implement parser" }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: taskArgs })
  await hooks["tool.execute.before"]({ tool: "write" }, { args: { filePath: "/tmp/a.js" } })

  for (let i = 0; i < 5; i++) {
    const out = { text: `msg-${i}` }
    await hooks["experimental.text.complete"]({ messageID: `reg-${i}` }, out)
  }

  const reportsDir = join(sandbox, ".claude/reports")
  const sessionFiles = readdirSync(reportsDir).filter(f => f.endsWith("-session.json")).sort()
  assert.ok(sessionFiles.length > 0, "expected at least one auto session report")
  const report = JSON.parse(readFileSync(join(reportsDir, sessionFiles[sessionFiles.length - 1]), "utf-8"))
  const m = report.metrics || {}
  assert.equal(typeof m.taskDelegationCount, "number", "taskDelegationCount should exist")
  assert.equal(typeof m.delegationSavingsUsd, "number", "delegationSavingsUsd should exist")
  assert.equal(m.tasksDelegated, m.taskDelegationCount, "legacy tasksDelegated field should map to count")
})
