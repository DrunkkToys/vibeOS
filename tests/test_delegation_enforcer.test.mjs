// Unit tests for ~/.config/opencode/plugins/vibeOS
// Run: ~/.nvm/versions/node/v23.11.0/bin/node --test tests/test_delegation_enforcer.test.mjs
//
// We import the plugin module and exercise its hooks against fake input/output
// objects. Each test runs in a tmpdir so the real shared state file is safe.

import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Use a sandbox HOME so STATE_FILE inside the plugin points into tmpdir.
let sandbox
before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "delegation-test-"))
  mkdirSync(join(sandbox, ".claude/scratch"), { recursive: true })
  process.env.HOME = sandbox
})
beforeEach(() => {
  rmSync(join(sandbox, ".claude/model-tiers.json"), { force: true })
  rmSync(join(sandbox, ".claude/delegation-state.json"), { force: true })
  rmSync(join(sandbox, ".claude/savings-ledger.jsonl"), { force: true })
  rmSync(join(sandbox, ".claude/active-jobs.json"), { force: true })
  rmSync(join(sandbox, ".claude/global-learning.json"), { force: true })
})
after(() => rmSync(sandbox, { recursive: true, force: true }))

// Import lazily so HOME override is in effect when the module reads homedir().
async function loadPlugin() {
  // Cache-bust by appending a timestamp query — node's import cache is
  // per-URL but plugin captures STATE_FILE at module-eval, which uses
  // homedir() (read once). For tests we re-import each time.
  const mod = await import("../src/index.js?t=" + Date.now())
  return mod
}

// ── classify() ────────────────────────────────────────────────────────
test("classify: opus → high", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  // classify isn't exported; we exercise it via plugin init.
  const hooks = await DelegationEnforcer({ client: {}, directory: sandbox })
  // Plant model in shell.env path
  const envOut = { env: {} }
  // Need to seed currentModel: easier path — write opencode.json fake
  const opencodeDir = join(sandbox, ".opencode-test")
  mkdirSync(opencodeDir, { recursive: true })
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks2 = await DelegationEnforcer({ client: {}, directory: opencodeDir })
  await hooks2["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "high")
})

test("classify: deepseek-flash → mid", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "cheap" },
    trinity: { brain: { oc: "" }, medium: { oc: "" }, cheap: { oc: "" } },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-mid")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "mid")
})

test("classify: unknown → budget", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "cheap" },
    trinity: { brain: { oc: "" }, medium: { oc: "" }, cheap: { oc: "" } },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-budget")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "budget")
})

test("slot switch updates tier even when model ID is unchanged", async () => {
  const tiersPath = join(sandbox, ".claude/model-tiers.json")
  writeFileSync(tiersPath, JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/deepseek-chat" },
      medium: { oc: "deepseek/deepseek-chat" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "cheap" },
    tiers: { high: { regex: "opus" }, mid: { regex: "sonnet|flash" }, budget: { regex: "haiku|chat" } },
  }))

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-same-model-slots")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-chat" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const firstEnv = { env: {} }
  await hooks["shell.env"]({}, firstEnv)
  assert.equal(firstEnv.env.OPENCODE_MODEL_TIER, "budget")

  // Flip slot to brain while keeping model ID unchanged across slots.
  const tiers = JSON.parse(readFileSync(tiersPath, "utf-8"))
  tiers.selection.active_slot = "brain"
  writeFileSync(tiersPath, JSON.stringify(tiers))

  const secondEnv = { env: {} }
  await hooks["shell.env"]({}, secondEnv)
  assert.equal(secondEnv.env.OPENCODE_MODEL_TIER, "high")
})

// ── tool.execute.before — memory mode ────────────────────────────────
test("FREE tools (read) and SOFT_QUOTA tools (bash) produce no state write within quota limit", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-free")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const beforeCount = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
    : 0

  // read is FREE — passes silently with no state write
  await hooks["tool.execute.before"]({ tool: "read" })
  // bash is SOFT_QUOTA — first call just logs progress (n=1/5), no state write
  await hooks["tool.execute.before"]({ tool: "bash" })

  const afterCount = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
    : 0
  assert.equal(afterCount, beforeCount, "no warn recorded for FREE/SOFT_QUOTA within limit")
})

test("WARN_ON_DIRECT (write) records savings + does NOT throw", async () => {
  // Ensure trinity models are available so write enforcement can compute non-free savings.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: { high: { regex: "opus" }, mid: { regex: "sonnet" }, budget: { regex: "haiku" } },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-write")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const before = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : {}
  const beforeCount = before?.lifetime?.warn_count || 0

  await assert.doesNotReject(async () => {
    await hooks["tool.execute.before"]({ tool: "write" })
  })

  const after = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.equal(after.lifetime.warn_count, beforeCount + 1, "warn_count incremented")
  assert.ok(after.lifetime.est_savings_usd > (before?.lifetime?.est_savings_usd || 0), "savings increased")
})

test("WARN_ON_DIRECT (notebookedit) records savings at high tier", async () => {
  // Write tiers BEFORE loadPlugin() so module-level TRINITY_CHEAP is set correctly.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: { high: { regex: "opus" }, mid: { regex: "sonnet" }, budget: { regex: "haiku" } },
  }))
  const { DelegationEnforcer, modelCostPerTurn } = await loadPlugin()
  const dir = join(sandbox, ".opencode-nbedit")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const before = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : {}
  const beforeCount = before?.lifetime?.warn_count || 0
  const beforeSavings = before?.lifetime?.est_savings_usd || 0

  await hooks["tool.execute.before"]({ tool: "notebookedit" })

  const after = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.equal(after.lifetime.warn_count, beforeCount + 1, "warn_count incremented for notebookedit")
  // Dynamic estimate: opus brain - haiku worker = 0.12 - 0.005 = 0.115
  const expectedSaving = modelCostPerTurn("anthropic/claude-opus-4-7") - modelCostPerTurn("anthropic/claude-haiku-4-5")
  assert.ok(
    Math.abs(after.lifetime.est_savings_usd - (beforeSavings + expectedSaving)) < 0.001,
    `saving = opus(${modelCostPerTurn("anthropic/claude-opus-4-7")}) - haiku(${modelCostPerTurn("anthropic/claude-haiku-4-5")}) = ${expectedSaving}, got delta ${after.lifetime.est_savings_usd - beforeSavings}`
  )
})

test("budget-tier tool calls DO record warns (all tiers enforce)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-budgetenforce")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const beforeCount = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
    : 0

  await hooks["tool.execute.before"]({ tool: "write" })
  await hooks["tool.execute.before"]({ tool: "edit" })

  const after = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : { lifetime: { warn_count: beforeCount } }
  assert.ok(after.lifetime.warn_count > beforeCount, "warns now recorded for all tiers (not just high)")
})

// ── Soft quota: fires exactly once at SOFT_QUOTA_LIMIT+1 ─────────────
test("SOFT_QUOTA (bash): fires exactly once at limit+1, records $0.00 saving", async () => {
  // Fresh sandbox so softQuotaCounts and state start empty.
  const sb = mkdtempSync(join(tmpdir(), "softquota-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { DelegationEnforcer } = await loadPlugin()
    const dir = join(sb, "proj")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
    const hooks = await DelegationEnforcer({ client: {}, directory: dir })

    const stateFile = join(sb, ".claude/delegation-state.json")

    // Calls 1–5: within limit, no state write
    for (let i = 0; i < 5; i++) {
      await hooks["tool.execute.before"]({ tool: "bash" })
    }
    assert.equal(existsSync(stateFile), false, "no state written for calls within limit")

    // Call 6 (= SOFT_QUOTA_LIMIT+1): fires exactly once
    await hooks["tool.execute.before"]({ tool: "bash" })
    assert.ok(existsSync(stateFile), "state written on call 6 (limit+1)")
    const s = JSON.parse(readFileSync(stateFile, "utf-8"))
    assert.equal(s.lifetime.warn_count, 1, "exactly one warn recorded at threshold")
    // SOFT_QUOTA records $0.00 — tool runs regardless, no real saving
    assert.equal(s.lifetime.est_savings_usd, 0, "SOFT_QUOTA saving is $0.00")

    // Call 7: no additional state write (fires-once)
    const warnBefore = s.lifetime.warn_count
    await hooks["tool.execute.before"]({ tool: "bash" })
    const s2 = JSON.parse(readFileSync(stateFile, "utf-8"))
    assert.equal(s2.lifetime.warn_count, warnBefore, "no additional warn after threshold already fired")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

// ── experimental.chat.messages.transform ─────────────────────────────
test("messages.transform: injects protocol when Task tool_result present", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-msgtest")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // OC internal format: { info, parts[] } — ToolPart with status=completed and tool="task"
  const messages = [
    { info: { role: "user" }, parts: [{ type: "text", text: "do thing" }] },
    {
      info: { role: "assistant" },
      parts: [{ type: "tool", tool: "task", callID: "tu_1", state: { status: "completed", output: "result", title: "task" } }]
    },
    { info: { role: "user" }, parts: [{ type: "text", text: "ok" }] },
  ]
  await hooks["experimental.chat.messages.transform"]({}, { messages })

  const lastMsg = messages[2]
  const hasProtocol = lastMsg.parts.some(p => p?.type === "text" && p?.text?.includes("[wbp-v1]"))
  assert.ok(hasProtocol, "protocol marker injected into user msg after Task tool result")
})

test("messages.transform: NO injection when no Task tool_result", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-msgnotask")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // OC internal format with no task tool parts
  const messages = [
    { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
    { info: { role: "assistant" }, parts: [{ type: "text", text: "hello" }] },
  ]
  const before = JSON.stringify(messages)
  await hooks["experimental.chat.messages.transform"]({}, { messages })
  assert.equal(JSON.stringify(messages), before, "messages unchanged when no Task results")
})

test("messages.transform: idempotent (marker prevents double-inject)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-msgidem")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // OC internal format
  const messages = [
    {
      info: { role: "assistant" },
      parts: [{ type: "tool", tool: "task", callID: "tu_x", state: { status: "completed", output: "r", title: "task" } }]
    },
    { info: { role: "user" }, parts: [{ type: "text", text: "ok" }] },
  ]
  await hooks["experimental.chat.messages.transform"]({}, { messages })
  await hooks["experimental.chat.messages.transform"]({}, { messages })
  await hooks["experimental.chat.messages.transform"]({}, { messages })

  const protocolCount = messages[1].parts.filter(p => p?.type === "text" && p?.text?.includes("[wbp-v1]")).length
  assert.equal(protocolCount, 1, "exactly one protocol injection across 3 calls")
})

// ── context7 detection + isDocsTarget ────────────────────────────────
test("detectContext7: scans config files, returns true if 'context7' present", async () => {
  const { detectContext7 } = await loadPlugin()
  const tmp = mkdtempSync(join(tmpdir(), "c7-"))
  const f1 = join(tmp, "config.json")
  writeFileSync(f1, JSON.stringify({ mcpServers: { context7: {} } }))
  assert.equal(detectContext7([f1]), true)
})

test("detectContext7: returns false if no config has context7", async () => {
  const { detectContext7 } = await loadPlugin()
  const tmp = mkdtempSync(join(tmpdir(), "c7-"))
  const f1 = join(tmp, "config.json")
  writeFileSync(f1, JSON.stringify({ mcpServers: { other: {} } }))
  assert.equal(detectContext7([f1]), false)
  // Honors env override.
  const prev = process.env.CLAUDE_CONTEXT7_AVAILABLE
  process.env.CLAUDE_CONTEXT7_AVAILABLE = "1"
  assert.equal(detectContext7([f1]), true)
  if (prev === undefined) delete process.env.CLAUDE_CONTEXT7_AVAILABLE
  else process.env.CLAUDE_CONTEXT7_AVAILABLE = prev
})

test("isDocsTarget: matches docs URLs and queries", async () => {
  const { isDocsTarget } = await loadPlugin()
  assert.equal(isDocsTarget("https://docs.python.org/3/"), true)
  assert.equal(isDocsTarget("https://npmjs.com/package/lodash"), true)
  assert.equal(isDocsTarget("https://example.com/api/v1/users"), true)
  assert.equal(isDocsTarget("https://twitter.com/foo"), false)
  assert.equal(isDocsTarget(""), false)
  assert.equal(isDocsTarget(null), false)
})

// ── buildTestReminder ────────────────────────────────────────────────
test("buildTestReminder: .py file → suggests test_*.py", async () => {
  const { buildTestReminder } = await loadPlugin()
  const r = buildTestReminder("/proj/foo.py")
  assert.ok(r && r.includes("test_foo.py"))
})

test("buildTestReminder: test file itself → null", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.equal(buildTestReminder("/proj/tests/test_foo.py"), null)
  assert.equal(buildTestReminder("/proj/foo.test.js"), null)
})

test("buildTestReminder: non-source extension → null", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.equal(buildTestReminder("/proj/README.md"), null)
  assert.equal(buildTestReminder("/proj/config.json"), null)
})

test("buildTestReminder: dedup — same path twice → second call null", async () => {
  const { buildTestReminder } = await loadPlugin()
  // loadPlugin uses cache-busted import so dedup state is fresh per test.
  const path = "/proj/uniq-" + Date.now() + ".js"
  assert.ok(buildTestReminder(path))
  assert.equal(buildTestReminder(path), null)
})

test("buildTestReminder: skips node_modules and plugins dir", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.equal(buildTestReminder("/proj/node_modules/x/y.js"), null)
  assert.equal(buildTestReminder("/u/.config/opencode/plugins/foo.js"), null)
})

test("buildTestReminder: language-appropriate suggestions", async () => {
  const { buildTestReminder } = await loadPlugin()
  assert.match(buildTestReminder("/p/srv.go"), /srv_test\.go/)
  assert.match(buildTestReminder("/p/util.ts"), /util\.test\.ts/)
})

// ── context7 install-suggestion + per-session alert ──────────────────
test("context7 absent + docs URL: creates one-time install flag + accumulates missed savings", async () => {
  // Fresh sandbox so neither flag nor state pre-exists.
  const sb = mkdtempSync(join(tmpdir(), "c7-suggest-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { DelegationEnforcer } = await loadPlugin()
    const dir = join(sb, "proj")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
    const hooks = await DelegationEnforcer({ client: {}, directory: dir })

    const flag = join(sb, ".claude/.context7-install-suggested")
    assert.equal(existsSync(flag), false, "flag absent before first docs hit")

    const { modelCostPerTurn: mcp } = await loadPlugin()
    const estC7 = mcp("anthropic/claude-opus-4-7") ?? 0.05

    await hooks["tool.execute.before"]({ tool: "webfetch" }, { args: { url: "https://docs.python.org/3/" } })
    assert.equal(existsSync(flag), true, "install-suggested flag created on first docs hit")
    let s = JSON.parse(readFileSync(join(sb, ".claude/delegation-state.json"), "utf-8"))
    assert.ok(Math.abs(s.lifetime.missed_context7_usd - estC7) < 0.001,
      `missed counter = ${estC7} after 1 event, got ${s.lifetime.missed_context7_usd}`)

    await hooks["tool.execute.before"]({ tool: "webfetch" }, { args: { url: "https://docs.python.org/3/library/os.html" } })
    s = JSON.parse(readFileSync(join(sb, ".claude/delegation-state.json"), "utf-8"))
    assert.ok(Math.abs(s.lifetime.missed_context7_usd - estC7 * 2) < 0.001,
      `missed counter accumulates to ${(estC7 * 2).toFixed(3)} after 2 events, got ${s.lifetime.missed_context7_usd}`)
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("context7 absent + non-docs URL: no flag created, no missed savings", async () => {
  const sb = mkdtempSync(join(tmpdir(), "c7-nondocs-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { DelegationEnforcer } = await loadPlugin()
    const dir = join(sb, "proj")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
    const hooks = await DelegationEnforcer({ client: {}, directory: dir })

    await hooks["tool.execute.before"]({ tool: "webfetch" }, { args: { url: "https://twitter.com/foo" } })
    const flag = join(sb, ".claude/.context7-install-suggested")
    assert.equal(existsSync(flag), false, "no flag for non-docs URL")
    const stateFile = join(sb, ".claude/delegation-state.json")
    if (existsSync(stateFile)) {
      const s = JSON.parse(readFileSync(stateFile, "utf-8"))
      assert.equal(s.lifetime?.missed_context7_usd ?? 0, 0, "no missed savings recorded")
    }
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

// ── scratchpad read-only detection ───────────────────────────────────
test("getScratchpadHit: matches bash-written hash format", async () => {
  const { createHash } = await import("node:crypto")
  const { getScratchpadHit } = await loadPlugin()

  const tmp = mkdtempSync(join(tmpdir(), "scratchpad-"))
  // Bash writes hash = sha256("Read\n<json>\n") truncated to 16 chars.
  const args = { file_path: "/etc/hosts" }
  const hash = createHash("sha256").update(`Read\n${JSON.stringify(args)}\n`).digest("hex").slice(0, 16)
  writeFileSync(join(tmp, `${hash}.txt`), "x".repeat(2048))

  const hit = getScratchpadHit("read", args, tmp)
  assert.ok(hit, "hit detected")
  assert.equal(hit.hash, hash)
  assert.equal(hit.sizeBytes, 2048)
  assert.equal(hit.summaryPath, null)
})

test("getScratchpadHit: returns null when no cache file", async () => {
  const { getScratchpadHit } = await loadPlugin()
  const tmp = mkdtempSync(join(tmpdir(), "scratchpad-empty-"))
  assert.equal(getScratchpadHit("read", { file_path: "/x" }, tmp), null)
})

test("getScratchpadHit: skips non-cacheable tools", async () => {
  const { getScratchpadHit } = await loadPlugin()
  const tmp = mkdtempSync(join(tmpdir(), "scratchpad-skip-"))
  assert.equal(getScratchpadHit("write", { file_path: "/x" }, tmp), null)
  assert.equal(getScratchpadHit("edit", { file_path: "/x" }, tmp), null)
  assert.equal(getScratchpadHit("task", {}, tmp), null)
})

test("getScratchpadHit: surfaces summary path when present", async () => {
  const { createHash } = await import("node:crypto")
  const { getScratchpadHit } = await loadPlugin()
  const tmp = mkdtempSync(join(tmpdir(), "scratchpad-sum-"))
  const args = { command: "ls" }
  const hash = createHash("sha256").update(`Bash\n${JSON.stringify(args)}\n`).digest("hex").slice(0, 16)
  writeFileSync(join(tmp, `${hash}.txt`), "full body")
  writeFileSync(join(tmp, `${hash}.summary.txt`), "short summary")
  const hit = getScratchpadHit("bash", args, tmp)
  assert.ok(hit?.summaryPath?.endsWith(".summary.txt"))
})

// ── experimental.text.complete ───────────────────────────────────────
test("text.complete: appends savings tag to assistant text", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-textcomp")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Pre-seed state with lifetime savings + a session edit warn
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const sid = "opencode-" + process.pid
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 5, est_savings_usd: 0.4, last_updated: "now" },
    sessions: { [sid]: { warns: [{ at: "now", tool: "edit", reason: "high-tier direct edit", est_savings_usd: 0.07 }], last_costed: "now" } }
  }))

  const out = { text: "Done." }
  await hooks["experimental.text.complete"]({ messageID: "msg-1" }, out)
  assert.match(out.text, /— \[.+\] \| vibeOS: 0\.40 saved [↑↓→] —/, "compact footer format")
  assert.doesNotMatch(out.text, /flow \d+w|edit -\$|cache -\$|\$.*\/hr/, "no verbose breakdown in footer")
})

test("text.complete: dedup by messageID", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-textdedup")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out = { text: "Hi." }
  await hooks["experimental.text.complete"]({ messageID: "msg-dedup" }, out)
  const first = out.text
  await hooks["experimental.text.complete"]({ messageID: "msg-dedup" }, out)
  assert.equal(out.text, first, "second call for same messageID does not append again")
})

test("text.complete: footer format is stable and compact (immutable contract)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-text-format")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const sid = "opencode-" + process.pid
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 1, est_savings_usd: 0.27, last_updated: "now", cache_savings_usd: 0 },
    sessions: {
      [sid]: {
        started: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        warns: [{ at: "now", tool: "edit", reason: "high-tier direct edit", est_savings_usd: 0.27 }],
        tool_counts: { edit: 1 },
      },
    },
  }))

  const out = { text: "ok" }
  await hooks["experimental.text.complete"]({ messageID: "msg-format-1" }, out)
  const footerLine = out.text.split("\n").slice(-1)[0]
  assert.match(footerLine, /^— \[.+\] \| vibeOS: \d+\.\d{2} saved [↑↓→] —$/, "exact footer contract")
  assert.doesNotMatch(footerLine, /\| flow |edit -\$|cache -\$|\(.*m\)|\/hr/, "no verbose fragments")
})

test("text.complete: auto-rebuilds state from ledger when state total is lower, footer shows reconstructed historical total", async () => {
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const ledgerFile = join(sandbox, ".claude/savings-ledger.jsonl")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 1, est_savings_usd: 0.01, cache_savings_usd: 0.00, last_updated: new Date().toISOString() },
    sessions: {},
  }, null, 2))
  const ledgerRows = [
    JSON.stringify({ type: "delegation", amount_usd: 1.25, at: new Date().toISOString() }),
    JSON.stringify({ type: "cache", amount_usd: 0.31, at: new Date().toISOString() }),
  ].join("\n") + "\n"
  writeFileSync(ledgerFile, ledgerRows)

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-ledger-reconcile")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out = { text: "hello" }
  await hooks["experimental.text.complete"]({ messageID: "msg-ledger-rebuild" }, out)
  const footer = out.text.split("\n").slice(-1)[0]
  assert.match(footer, /vibeOS: 1\.56 saved [↑↓→]/, "footer must show reconstructed ledger historical total")

  const reconciled = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.equal(reconciled.lifetime.est_savings_usd, 1.25, "delegation savings rebuilt from ledger")
  assert.equal(reconciled.lifetime.cache_savings_usd, 0.31, "cache savings rebuilt from ledger")
})

// ── tool.execute.after — output field ────────────────────────────────
test("tool.execute.after: compresses webfetch output via output.result field", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-aftercomp")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Build a long output that exceeds the 3000-char truncation threshold.
  // Plugin reads/writes output.result (not output.output).
  const longText = "A".repeat(3500)
  const out = { title: "webfetch result", result: longText, metadata: {} }
  await hooks["tool.execute.after"]({ tool: "webfetch", callID: "c1", args: {} }, out)
  assert.ok(out.result.length < longText.length, "output.result was compressed/truncated")
  assert.ok(out.result.includes("truncated"), "truncation marker present")
})

test("tool.execute.after: test-reminder injected into output.result for write tool", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-testremind")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Plugin writes reminder to output.text or output.result, not output.output.
  const out = { title: "write result", result: "ok", metadata: {} }
  await hooks["tool.execute.after"](
    { tool: "write", callID: "c2", args: { filePath: `/tmp/remind-${Date.now()}.py` } },
    out
  )
  assert.match(out.result, /\[test-reminder\]/, "test-reminder appended to output.result")
})

test("tool.execute.after: does not set output.result/text/content/data (wrong field names)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-wrongfields")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const longText = "B".repeat(3500)
  const out = { title: "task result", output: longText, metadata: {} }
  await hooks["tool.execute.after"]({ tool: "task", callID: "c3", args: {} }, out)
  assert.equal(out.result, undefined, "output.result must remain undefined")
  assert.equal(out.text, undefined, "output.text must remain undefined")
  assert.equal(out.content, undefined, "output.content must remain undefined")
  assert.equal(out.data, undefined, "output.data must remain undefined")
})

test("tool.execute.after: shows model label even with no savings recorded", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-textempty")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Reset state — no savings recorded
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 0, est_savings_usd: 0, last_updated: "" }
  }))

  const out = { text: "Hi." }
  await hooks["experimental.text.complete"]({ messageID: "msg-empty-sav" }, out)
  // Model label always shown; no savings line when count=0
  assert.match(out.text, /High|Mid|Budget/, "model label shown even when no savings")
  assert.doesNotMatch(out.text, /saved/, "no savings line when count=0")
})

// ── Stall-fix tests ──────────────────────────────────────────────────────────
// These verify fixes for model-stalling bugs in v0.4.5.

test("system.transform: no thinking directive injected by default", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall1")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out)
  // Should have context7 directive + orchestrator directive, but NO thinking directive
  const allText = out.system.join(" ")
  assert.ok(allText.includes("cost policy"), "context7 directive present")
  assert.ok(allText.includes("AI ORCHESTRATOR AGENT"), "orchestrator directive present")
  assert.doesNotMatch(allText, /thinking policy|Reasoning depth|Skip extended thinking/i,
    "no thinking directive auto-injected")
})

test("system.transform: thinking directive injected when manually set to off", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall2")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  // Manually set thinking_level in model-tiers.json
  const tiersFile = join(sandbox, ".claude/model-tiers.json")
  writeFileSync(tiersFile, JSON.stringify({
    selection: { enabled: true, thinking_level: "off" },
    trinity: { brain: { oc: "anthropic/claude-opus-4-7" } }
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out)
  const allText = out.system.join(" ")
  assert.ok(allText.includes("thinking policy"), "thinking directive injected")
  assert.ok(/off/i.test(allText), "off level mentioned")
  assert.ok(allText.includes("manually set"), "marked as manual override")
  assert.ok(allText.includes("Respond directly and concisely"),
    "off directive says to respond directly")
})

test("system.transform: thinking directive NOT injected when manually set to full", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall3")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const tiersFile = join(sandbox, ".claude/model-tiers.json")
  writeFileSync(tiersFile, JSON.stringify({
    selection: { enabled: true, thinking_level: "full" }
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out)
  const allText = out.system.join(" ")
  assert.doesNotMatch(allText, /thinking policy|Reasoning depth/i,
    "no thinking directive for 'full'")
})

test("system.transform: injects job-focus directive when request is off-topic vs active job", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "brain", delegation_enforce: true },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-jobfocus")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Seed active job via Task prompt.
  const taskPrompt = "Migrate TypeScript modules, validate footer format, and run typecheck + test suite."
  await hooks["tool.execute.before"](
    { tool: "task", args: { prompt: taskPrompt } },
    { args: { prompt: taskPrompt } }
  )

  const out = { system: [] }
  await hooks["experimental.chat.system.transform"](
    { role: "user", content: "Book flights and hotels for Tokyo with cheapest dates." },
    out
  )
  const allText = out.system.join(" ")
  assert.ok(allText.includes("[job-focus]"), "job-focus directive should be injected for off-topic request")
})

test("system.transform: active job is project-scoped and does not leak across projects", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "brain", delegation_enforce: true },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()

  const dirA = join(sandbox, ".opencode-jobscope-a")
  mkdirSync(dirA, { recursive: true })
  writeFileSync(join(dirA, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  const hooksA = await DelegationEnforcer({ client: {}, directory: dirA })
  const aPrompt = "Refactor ledger persistence and reconcile footer totals with historical savings."
  await hooksA["tool.execute.before"](
    { tool: "task", args: { prompt: aPrompt } },
    { args: { prompt: aPrompt } }
  )

  const dirB = join(sandbox, ".opencode-jobscope-b")
  mkdirSync(dirB, { recursive: true })
  writeFileSync(join(dirB, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  const hooksB = await DelegationEnforcer({ client: {}, directory: dirB })
  const outB = { system: [] }
  await hooksB["experimental.chat.system.transform"](
    { role: "user", content: "Book flights and hotels for Tokyo with cheapest dates." },
    outB
  )
  const bText = outB.system.join(" ")
  assert.equal(bText.includes("[job-focus]"), false, "project B should not inherit project A active job context")
})

test("messages.transform: compression ref is neutral (no 'Read' imperative)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall4")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Build a message with a large tool result that exceeds COMPRESS_THRESHOLD (2000)
  // Tool result must be in the "cold" zone (not in last KEEP_HOT=10 messages)
  const largeOutput = "X".repeat(3000)
  const toolMsg = {
    info: { role: "assistant" },
    parts: [{
      type: "tool", tool: "bash", callID: "c1",
      state: { status: "completed", output: largeOutput }
    }]
  }
  const fillerMsgs = Array.from({ length: 11 }, () =>
    ({ info: { role: "user" }, parts: [{ type: "text", text: "filler" }] })
  )
  const messages = [
    toolMsg,           // index 0 → cold zone (hotStart = 13 - 10 = 3)
    ...fillerMsgs,
    { info: { role: "user" }, parts: [{ type: "text", text: "ok" }] },
  ]

  await hooks["experimental.chat.messages.transform"]({}, { messages })

  const toolPart = messages[0].parts.find(p => p?.type === "tool")
  assert.ok(toolPart, "tool part exists")
  const ref = toolPart.state.output
  assert.ok(ref.includes("cold storage"), "ref contains 'cold storage' marker")
  assert.doesNotMatch(ref, /\bRead\b/, "ref does NOT contain 'Read' imperative")
  assert.doesNotMatch(ref, /Full content/, "ref does NOT contain 'Full content'")
})

test("tool.execute.after: task output NOT compressed (only webfetch)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall5")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const longText = "A".repeat(3500)
  const out = { title: "task result", result: longText, metadata: {} }
  await hooks["tool.execute.after"]({ tool: "task", callID: "c1", args: {} }, out)
  // Task output must remain unchanged
  assert.equal(out.result.length, longText.length, "task output not compressed")
  assert.equal(out.result, longText, "task output identical")
})

test("tool.execute.after: webfetch output IS compressed", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-stall6")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const longText = "A".repeat(3500)
  const out = { title: "webfetch result", result: longText, metadata: {} }
  await hooks["tool.execute.after"]({ tool: "webfetch", callID: "c1", args: {} }, out)
  assert.ok(out.result.length < longText.length, "webfetch output compressed")
})

// ── Flow enforcer tests ──────────────────────────────────────────────────────

test("flow: Write .md file triggers new-md-file warn", async () => {
  const { checkFlowRules, resetForTest, getSessionFlowCounts } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-md-file", severity: "warn", trigger: "Write", pattern: "\\.md$", description: "New markdown" },
    { id: "todo-comment", severity: "hint", trigger: "Edit", pattern: "TODO", description: "TODO left in output" },
  ])
  const hits = checkFlowRules({ tool: "Write", filePath: "README.md", content: "# Title" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "new-md-file")
  assert.equal(hits[0].severity, "warn")
  assert.equal(hits[0].deduped, false)
})

test("flow: trigger matching is case-insensitive", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-md-file", severity: "warn", trigger: "Write", pattern: "\\.md$", description: "New markdown" },
  ])
  const hits = checkFlowRules({ tool: "write", filePath: "README.md", content: "# Title" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "new-md-file")
})

test("flow: Write file outside src/ triggers new-file-outside-src hint", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-file-outside-src", severity: "hint", trigger: "Write", pattern: "^(?!src/|\\.)", description: "Outside src" },
  ])
  const hits = checkFlowRules({ tool: "Write", filePath: "/tmp/test.py", content: "x=1" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "new-file-outside-src")
  assert.equal(hits[0].severity, "hint")
})

test("flow: Write file in src/ does NOT trigger new-file-outside-src", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-file-outside-src", severity: "hint", trigger: "Write", pattern: "^(?!src/|\\.)", description: "Outside src" },
  ])
  const hits = checkFlowRules({ tool: "Write", filePath: "src/index.js", content: "x=1" })
  assert.equal(hits.length, 0)
})

test("flow: Edit with compat-shim triggers warn", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "compat-shim", severity: "warn", trigger: "Edit", pattern: "_old|_legacy|# removed", description: "Compat shim" },
  ])
  const hits = checkFlowRules({ tool: "Edit", filePath: "src/foo.js", content: "function getConfig_old() {}" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "compat-shim")
  assert.equal(hits[0].severity, "warn")
})

test("flow: Edit with TODO triggers hint", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "todo-comment", severity: "hint", trigger: "Edit", pattern: "TODO|FIXME|HACK", description: "TODO left" },
  ])
  const hits = checkFlowRules({ tool: "Edit", filePath: "src/bar.js", content: "// TODO: fix this later" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "todo-comment")
  assert.equal(hits[0].severity, "hint")
})

test("flow: Non-matching trigger is ignored", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "todo-comment", severity: "hint", trigger: "Edit", pattern: "TODO", description: "TODO left" },
  ])
  // Write tool, but rule is Edit-only — no match
  const hits = checkFlowRules({ tool: "Write", filePath: "src/bar.js", content: "// TODO: fix later" })
  assert.equal(hits.length, 0)
})

test("flow: Dedup per rule+file — second call is deduped", async () => {
  const { checkFlowRules, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-md-file", severity: "warn", trigger: "Write", pattern: "\\.md$", description: "New markdown" },
  ])
  const h1 = checkFlowRules({ tool: "Write", filePath: "README.md", content: "# Title" })
  assert.equal(h1.length, 1)
  assert.equal(h1[0].deduped, false)
  const h2 = checkFlowRules({ tool: "Write", filePath: "README.md", content: "## Section" })
  assert.equal(h2.length, 1)
  assert.equal(h2[0].deduped, true)
})

test("flow: getSessionFlowCounts returns correct counts", async () => {
  const { checkFlowRules, resetForTest, getSessionFlowCounts } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-md-file", severity: "warn", trigger: "Write", pattern: "\\.md$", description: "New markdown" },
    { id: "new-file-outside-src", severity: "hint", trigger: "Write", pattern: "^(?!src/)", description: "Outside src" },
  ])
  // src/CHANGELOG.md triggers warn (\.md$) but NOT hint (starts with src/)
  checkFlowRules({ tool: "Write", filePath: "src/CHANGELOG.md", content: "# Title" })
  // /tmp/x.py triggers hint (not .md) — only 1 rule each
  checkFlowRules({ tool: "Write", filePath: "/tmp/x.py", content: "x=1" })
  const counts = getSessionFlowCounts()
  assert.equal(counts.warn, 1)
  assert.equal(counts.hint, 1)
  assert.equal(counts.flag, 0)
})

test("flow: resetForTest clears all state", async () => {
  const { checkFlowRules, resetForTest, getSessionFlowCounts } = await import("../src/flow-enforcer.js?t=" + Date.now())
  resetForTest([
    { id: "new-md-file", severity: "warn", trigger: "Write", pattern: "\\.md$", description: "New markdown" },
  ])
  checkFlowRules({ tool: "Write", filePath: "README.md", content: "# Title" })
  assert.equal(getSessionFlowCounts().warn, 1)
  resetForTest([])
  assert.equal(getSessionFlowCounts().warn, 0)
  const hits = checkFlowRules({ tool: "Write", filePath: "README.md", content: "# Title" })
  assert.equal(hits.length, 0)
})

// ── Two-tier Trinity routing ─────────────────────────────────────────────────
// TRINITY_MEDIUM/CHEAP are module-level constants evaluated at import time, so
// model-tiers.json must be written to sandbox BEFORE loadPlugin() is called.

test("task routing: high-tier brain → TRINITY_MEDIUM when medium is set", async () => {
  // Write tiers BEFORE loadPlugin() so module-level loadTrinityModels() picks it up.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus" },
      mid:    { regex: "sonnet" },
      budget: { regex: "haiku" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-task-high")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const args = { model: "anthropic/claude-opus-4-7", prompt: "go" }
  const out  = { args }
  await hooks["tool.execute.before"]({ tool: "task" }, out)
  assert.equal(out.args.model, "anthropic/claude-sonnet-4-6", "high-tier brain routes Task to medium")
})

test("task routing: mid-tier brain → TRINITY_CHEAP", async () => {
  // Write tiers (no medium to force cheap path) BEFORE loadPlugin().
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus" },
      mid:    { regex: "sonnet" },
      budget: { regex: "haiku" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-task-mid")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-sonnet-4-6" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const args = { model: "anthropic/claude-sonnet-4-6", prompt: "go" }
  const out  = { args }
  await hooks["tool.execute.before"]({ tool: "task" }, out)
  assert.equal(out.args.model, "anthropic/claude-haiku-4-5", "mid-tier brain routes Task to cheap")
})

test("task routing: exploratory first-word routes to TRINITY_CHEAP regardless of tier", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus" },
      mid:    { regex: "sonnet" },
      budget: { regex: "haiku" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-task-exploratory")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  for (const word of ["find", "check", "list", "search", "verify"]) {
    const args = { model: "anthropic/claude-opus-4-7", prompt: `${word} all usages of X` }
    const out  = { args }
    await hooks["tool.execute.before"]({ tool: "task" }, out)
    assert.equal(out.args.model, "anthropic/claude-haiku-4-5",
      `exploratory prompt starting with '${word}' routes to cheap slot`)
    args.model = "anthropic/claude-opus-4-7"  // reset for next iteration
  }
})

test("task routing: credit < 40% + Task forces cheap slot (not medium)", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus" },
      mid:    { regex: "sonnet" },
      budget: { regex: "haiku" },
    },
  }))
  process.env.CLAUDE_CREDIT_PERCENT = "25"
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-task-credit")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const args = { model: "anthropic/claude-opus-4-7", prompt: "implement the feature" }
  const out  = { args }
  await hooks["tool.execute.before"]({ tool: "task" }, out)
  delete process.env.CLAUDE_CREDIT_PERCENT

  assert.equal(out.args.model, "anthropic/claude-haiku-4-5",
    "credit<40% + Task forced to cheap slot (bypasses medium)")
})

// ── Credit < 40% warn ────────────────────────────────────────────────────────
test("credit < 40%: records OPUS_DISABLE saving for high-tier non-task tool", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-credit")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { cheap: { oc: "anthropic/claude-haiku-4-5" } },
    selection: { enabled: true },
    tiers: { high: { regex: "opus" }, mid: { regex: "sonnet" }, budget: { regex: "haiku" } },
  }))
  process.env.CLAUDE_CREDIT_PERCENT = "30"
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)

  await hooks["tool.execute.before"]({ tool: "write" }, { args: { filePath: "/tmp/f.js" } })
  delete process.env.CLAUDE_CREDIT_PERCENT

  assert.ok(existsSync(stateFile), "state file created after credit<40% warn")
  const state = JSON.parse(readFileSync(stateFile, "utf-8"))
  const { modelCostPerTurn: mcp } = await loadPlugin()
  const expectedOpus = mcp("anthropic/claude-opus-4-7") ?? 0.14
  assert.ok(state.lifetime.warn_count >= 1, "warn_count incremented")
  assert.ok(state.lifetime.est_savings_usd >= expectedOpus * 0.9, `OPUS_DISABLE saving ≈ $${expectedOpus} recorded`)
})

// ── Model pricing table ──────────────────────────────────────────────────────
test("modelCostPerTurn: known models return expected $/turn", async () => {
  const { modelCostPerTurn } = await loadPlugin()
  assert.equal(modelCostPerTurn("anthropic/claude-opus-4-7"), 0.12, "opus = $0.12/turn")
  assert.equal(modelCostPerTurn("anthropic/claude-haiku-4-5"), 0.005, "haiku = $0.005/turn")
  assert.equal(modelCostPerTurn("deepseek/deepseek-chat"), 0, "deepseek-chat = $0 (free)")
  assert.equal(modelCostPerTurn("deepseek-chat"), 0, "deepseek-chat short form = $0 (free)")
  assert.equal(modelCostPerTurn(null), 0, "null → 0")
})

test("modelCostPerTurn: unknown model returns null (falls back to SAVE_EST)", async () => {
  const { modelCostPerTurn } = await loadPlugin()
  assert.equal(modelCostPerTurn("some/unknown-model-xyz"), null)
})

test("isModelFree: deepseek-chat is free; opus is not", async () => {
  const { isModelFree } = await loadPlugin()
  assert.equal(isModelFree("deepseek/deepseek-chat"), true)
  assert.equal(isModelFree("deepseek-chat"), true)
  assert.equal(isModelFree("anthropic/claude-opus-4-7"), false)
  assert.equal(isModelFree("anthropic/claude-haiku-4-5"), false)
  assert.equal(isModelFree("some/unknown-model"), false, "unknown model is not free (null cost)")
})

test("free-model brain: no enforcement warnings even at high tier", async () => {
  // Force deepseek-chat into high-tier by writing a tiers file that matches it.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { cheap: { oc: "anthropic/claude-haiku-4-5" } },
    selection: { enabled: true },
    tiers: {
      high:   { regex: "deepseek-chat|opus" },
      mid:    { regex: "sonnet" },
      budget: { regex: "haiku" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-free-brain")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-chat" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const beforeCount = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
    : 0

  await hooks["tool.execute.before"]({ tool: "write" })
  await hooks["tool.execute.before"]({ tool: "edit" })
  await hooks["tool.execute.before"]({ tool: "notebookedit" })

  const afterCount = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
    : 0
  assert.equal(afterCount, beforeCount,
    "no warn recorded when brain is a free model (deepseek-chat)")
})

test("dynamic estimate: opus brain + haiku worker → brain_cost - worker_cost", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "anthropic/claude-opus-4-7" },
      medium: { oc: "anthropic/claude-sonnet-4-6" },
      cheap:  { oc: "anthropic/claude-haiku-4-5" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: { high: { regex: "opus" }, mid: { regex: "sonnet" }, budget: { regex: "haiku" } },
  }))
  const { DelegationEnforcer, modelCostPerTurn } = await loadPlugin()
  const dir = join(sandbox, ".opencode-dyn-est")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)
  await hooks["tool.execute.before"]({ tool: "write" })

  const s = JSON.parse(readFileSync(stateFile, "utf-8"))
  // With haiku as cheap worker: saving = opus_cost - haiku_cost
  const expected = modelCostPerTurn("anthropic/claude-opus-4-7") - modelCostPerTurn("anthropic/claude-haiku-4-5")
  assert.ok(
    Math.abs(s.lifetime.est_savings_usd - expected) < 0.001,
    `saving = opus(${modelCostPerTurn("anthropic/claude-opus-4-7")}) - haiku(${modelCostPerTurn("anthropic/claude-haiku-4-5")}) = ${expected}, got ${s.lifetime.est_savings_usd}`
  )
})

// ── Session report writing ───────────────────────────────────────────────────
test("text.complete: writes session-report-pending.md when savings > 0", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-sesreport")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 3, est_savings_usd: 0.21, last_updated: "now" }
  }))

  const out = { text: "Done." }
  await hooks["experimental.text.complete"]({ messageID: "msg-report-1" }, out)

  const reportFile = join(sandbox, ".claude/session-report-pending.md")
  assert.ok(existsSync(reportFile), "session-report-pending.md written")
  const content = readFileSync(reportFile, "utf-8")
  assert.match(content, /vibeOS:/, "report contains vibeOS label")
  assert.match(content, /saved/, "report contains 'saved'")
})

test("tier override: openrouter sonnet brain slot classified as high", async () => {
  // Real-world case: user's brain slot is openrouter/anthropic/claude-sonnet-4.6
  // which matches the mid-tier regex (claude.*sonnet). The override must promote
  // it to high tier so enforcement warnings fire.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-sonnet-4.6" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap:  { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))
  const { DelegationEnforcer, modelCostPerTurn } = await loadPlugin()
  const dir = join(sandbox, ".opencode-or-sonnet-brain")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openrouter/anthropic/claude-sonnet-4.6" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)

  // Without override: sonnet → mid → no warn. With override: sonnet-as-brain → high → warn.
  await hooks["tool.execute.before"]({ tool: "write" })

  assert.ok(existsSync(stateFile), "state file written — enforcement triggered (tier=high)")
  const s = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.ok((s?.lifetime?.warn_count ?? 0) > 0,
    "warn recorded: openrouter/anthropic/claude-sonnet-4.6 as brain slot is treated as high tier")

  // Also verify cost lookup normalises the openrouter/ prefix
  assert.equal(modelCostPerTurn("openrouter/anthropic/claude-sonnet-4.6"), 0.024,
    "openrouter/ prefix stripped + dot normalised → matches anthropic/claude-sonnet-4-6 cost")
})

test("text.complete: appends to session-reports.log", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-seslog")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 2, est_savings_usd: 0.16, last_updated: "now" }
  }))

  await hooks["experimental.text.complete"]({ messageID: "msg-log-1" }, { text: "Hi." })
  await hooks["experimental.text.complete"]({ messageID: "msg-log-2" }, { text: "Hi." })

  const logFile = join(sandbox, ".claude/session-reports.log")
  assert.ok(existsSync(logFile), "session-reports.log created")
  const lines = readFileSync(logFile, "utf-8").trim().split("\n")
  assert.ok(lines.length >= 1, "at least one log entry written")
  assert.match(lines[0], /vibeOS:/, "log entry contains vibeOS label")
})

// ── new: modelToSlotLabel uses effectiveTier (brain-slot override) ────────────
test("text.complete: sonnet-as-brain shows 🧠 icon in footer (effectiveTier fix)", async () => {
  // When the active brain slot is openrouter/anthropic/claude-sonnet-4.6,
  // modelToSlotLabel must use currentTier="high" (overridden), not classify()="mid".
  // Result: footer must contain 🧠 not ⚙.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-sonnet-4.6" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap:  { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "brain" },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-sonnet-icon")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openrouter/anthropic/claude-sonnet-4.6" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Seed a non-zero savings total so the footer is always emitted.
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 1, est_savings_usd: 0.05, last_updated: "now" }
  }))

  const out = { text: "Hello." }
  await hooks["experimental.text.complete"]({ messageID: "msg-icon-1" }, out)

  assert.ok(out.text.includes("🧠"),
    `footer must contain 🧠 (brain icon) for sonnet-as-brain; got: ${out.text}`)
  assert.ok(!out.text.includes("⚙ Mid →"),
    `footer must NOT show ⚙ Mid → when mid is the brain slot; got: ${out.text}`)
})

// ── new: pendingUiNote injected into tool.execute.after output ────────────────
test("tool.execute.after: delegation warning injected into output.result", async () => {
  // After tool.execute.before fires for a write on a high-tier model,
  // tool.execute.after must inject the ⚠ [vibeOS] note into output.result
  // so it appears in the OC chat transcript, not just in stderr.
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-sonnet-4.6" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap:  { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: false },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-uinote")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openrouter/anthropic/claude-sonnet-4.6" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Clear state so warn_count starts at 0.
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)

  // Step 1: before-hook records the warning and sets pendingUiNote.
  const beforeOutput = { args: {} }
  await hooks["tool.execute.before"]({ tool: "edit" }, beforeOutput)

  // Step 2: after-hook must inject the note into output.result.
  const afterOutput = { result: "File edited successfully." }
  await hooks["tool.execute.after"]({ tool: "edit", args: { filePath: "/tmp/foo.py" } }, afterOutput)

  assert.ok(afterOutput.result.includes("⚠ [vibeOS]"),
    `output.result must contain ⚠ [vibeOS] delegation note; got: ${afterOutput.result}`)
  assert.ok(afterOutput.result.includes("model running edit"),
    `output.result must describe the action; got: ${afterOutput.result}`)
  assert.ok(afterOutput.result.startsWith("File edited successfully."),
    "original tool result must be preserved at the start")
})

// ── new: pendingUiNote cleared after consumption (no double-inject) ───────────
test("tool.execute.after: pendingUiNote consumed once — no double-inject on second call", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-sonnet-4.6" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap:  { oc: "deepseek/deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: false },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-uinote2")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openrouter/anthropic/claude-sonnet-4.6" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)

  // Fire before+after once (consumes pendingUiNote).
  await hooks["tool.execute.before"]({ tool: "write" }, { args: {} })
  const first = { result: "Written." }
  await hooks["tool.execute.after"]({ tool: "write", args: { filePath: "/tmp/a.py" } }, first)
  assert.ok(first.result.includes("⚠ [vibeOS]"), "first call: note injected")

  // Second after-hook call without a preceding before — pendingUiNote must be null.
  const second = { result: "Written again." }
  await hooks["tool.execute.after"]({ tool: "write", args: { filePath: "/tmp/b.py" } }, second)
  assert.ok(!second.result.includes("⚠ [vibeOS]"),
    "second call: note NOT injected (pendingUiNote was cleared after first consumption)")
})

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION: full simulated OC session — sonnet-as-brain does a real turn
// ════════════════════════════════════════════════════════════════════════════
//
// Simulates an entire OC session lifecycle:
//   1. Plugin loads with openrouter/anthropic/claude-sonnet-4.6 as brain
//   2. shell.env fires → OPENCODE_MODEL_TIER=high in env
//   3. A Task is routed to the medium slot
//   4. A write is done → pendingUiNote set in before, injected in after
//   5. experimental.text.complete fires → footer shows 🧠 Sonnet 4.6 + savings
//   6. session-report-pending.md written for CC
//   7. Enforcement is disabled at runtime → all hooks become no-ops
//   8. Re-enabled → enforcement resumes
test("integration: full simulated OC session with sonnet-as-brain", async () => {
  // ── Setup: isolated home with all config files ──────────────────────────
  const tiersFile = join(sandbox, ".claude/model-tiers.json")
  writeFileSync(tiersFile, JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-sonnet-4.6", cc: "sonnet" },
      medium: { oc: "deepseek/deepseek-v4-flash",             cc: "haiku"  },
      cheap:  { oc: "deepseek/deepseek-chat",                 cc: "haiku"  },
    },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: false },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))

  // Project dir has local opencode.json pointing at brain model
  const projDir = join(sandbox, "my-project")
  mkdirSync(projDir, { recursive: true })
  writeFileSync(join(projDir, "opencode.json"), JSON.stringify({
    model: "openrouter/anthropic/claude-sonnet-4.6",
  }))

  // Clear state
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  if (existsSync(stateFile)) rmSync(stateFile)

  const { DelegationEnforcer } = await loadPlugin()
  const hooks = await DelegationEnforcer({ client: {}, directory: projDir })

  // ── 1. shell.env: OPENCODE_MODEL_TIER must be "high" ───────────────────
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "high",
    "shell.env: sonnet-as-brain classified as high after override")

  // ── 2. Task routing: high-tier brain → medium slot ──────────────────────
  const taskArgs = { model: null, prompt: "Implement the new feature" }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: taskArgs })
  assert.equal(taskArgs.model, "deepseek/deepseek-v4-flash",
    "task routing: high-tier brain routes Task to medium slot (deepseek-v4-flash)")

  // ── 3. Task routing: exploratory prompt → cheap slot ───────────────────
  const taskArgs2 = { model: null, prompt: "find all usages of this function" }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: taskArgs2 })
  assert.equal(taskArgs2.model, "deepseek/deepseek-chat",
    "task routing: exploratory first-word routes to cheap slot")

  // ── 4. Write tool: before sets pendingUiNote, after injects it ──────────
  const writeBeforeOut = { args: {} }
  await hooks["tool.execute.before"]({ tool: "write" }, writeBeforeOut)
  assert.ok(existsSync(stateFile), "write: state file created after before-hook")
  const s1 = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.ok((s1?.lifetime?.warn_count ?? 0) >= 1,
    "write: warn_count incremented in state file")

  const writeAfterOut = { result: "File written." }
  await hooks["tool.execute.after"]({ tool: "write", args: { filePath: "/tmp/foo.py" } }, writeAfterOut)
  assert.ok(writeAfterOut.result.includes("⚠ [vibeOS]"),
    "write: delegation note visible in tool output (OC chat transcript)")
  assert.ok(writeAfterOut.result.startsWith("File written."),
    "write: original result preserved before the note")

  // ── 5. Edit tool: before+after same flow ───────────────────────────────
  await hooks["tool.execute.before"]({ tool: "edit" }, { args: {} })
  const editAfterOut = { result: "Edit applied." }
  await hooks["tool.execute.after"]({ tool: "edit", args: { filePath: "/tmp/foo.py" } }, editAfterOut)
  assert.ok(editAfterOut.result.includes("⚠ [vibeOS]"),
    "edit: delegation note injected")
  const s2 = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.ok((s2?.lifetime?.warn_count ?? 0) >= 2,
    "edit: second warn recorded cumulatively")

  // ── 6. experimental.text.complete: footer shows 🧠 + savings ───────────
  const textOut = { text: "Here is the plan." }
  await hooks["experimental.text.complete"]({ messageID: "msg-integ-1" }, textOut)
  assert.ok(textOut.text.includes("🧠"),
    "text.complete: footer shows 🧠 (brain icon, not ⚙ mid) for sonnet-as-brain")
  assert.ok(textOut.text.includes("vibeOS:"),
    "text.complete: footer shows vibeOS savings label")
  assert.match(textOut.text, /— \[.+\] \| vibeOS: \d+\.\d{2} saved [↑↓→] —/,
    "text.complete: footer uses compact immutable format")
  assert.ok(textOut.text.startsWith("Here is the plan."),
    "text.complete: original response text preserved")

  // ── 7. session-report-pending.md written for CC ─────────────────────────
  const reportFile = join(sandbox, ".claude/session-report-pending.md")
  assert.ok(existsSync(reportFile), "session-report-pending.md written after text.complete")
  const reportContent = readFileSync(reportFile, "utf-8")
  assert.ok(reportContent.includes("🧠") || reportContent.includes("Mid") || reportContent.includes("Budget"),
    "session-report: contains model info")
  assert.ok(reportContent.includes("vibeOS:"),
    "session-report: contains vibeOS label")

  // ── 8. Deduplication: same messageID doesn't double-append footer ───────
  const textOut2 = { text: "Another response." }
  await hooks["experimental.text.complete"]({ messageID: "msg-integ-1" }, textOut2)
  assert.ok(!textOut2.text.includes("vibeOS:"),
    "text.complete: duplicate messageID skipped — footer not appended again")

  // ── 9. Disable enforcement at runtime → hooks become no-ops ────────────
  const tiers = JSON.parse(readFileSync(tiersFile, "utf-8"))
  tiers.selection.enabled = false
  writeFileSync(tiersFile, JSON.stringify(tiers))

  const taskArgs3 = { model: null, prompt: "Implement something" }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: taskArgs3 })
  assert.equal(taskArgs3.model, null,
    "disabled: task routing skipped when enforcement disabled")

  const warnCountBefore = JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
  await hooks["tool.execute.before"]({ tool: "write" }, { args: {} })
  const warnCountAfter = JSON.parse(readFileSync(stateFile, "utf-8"))?.lifetime?.warn_count ?? 0
  assert.equal(warnCountAfter, warnCountBefore,
    "disabled: warn_count not incremented when enforcement disabled")

  // ── 10. Re-enable → routing resumes ─────────────────────────────────────
  tiers.selection.enabled = true
  writeFileSync(tiersFile, JSON.stringify(tiers))

  const taskArgs4 = { model: null, prompt: "Implement something again" }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: taskArgs4 })
  assert.equal(taskArgs4.model, "deepseek/deepseek-v4-flash",
    "re-enabled: task routing resumes after re-enabling")
})

test("task routing: learned exploratory first-word persists across projects via global learning", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "openrouter/anthropic/claude-opus-4-7", cc: "opus" },
      medium: { oc: "deepseek/deepseek-v4-flash",           cc: "sonnet" },
      cheap:  { oc: "deepseek/deepseek-chat",               cc: "haiku" },
    },
    selection: { enabled: true, active_slot: "medium", delegation_enforce: false },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro" },
      mid:    { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
  }))

  // Project A "teaches" the plugin that "triage" is exploratory by repeatedly
  // routing Task calls from mid tier to cheap.
  const projectA = join(sandbox, "proj-A")
  mkdirSync(projectA, { recursive: true })
  writeFileSync(join(projectA, "opencode.json"), JSON.stringify({ model: "anthropic/claude-sonnet-4-6" }))

  const { DelegationEnforcer } = await loadPlugin()
  const hooksA = await DelegationEnforcer({ client: {}, directory: projectA })
  for (let i = 0; i < 3; i++) {
    const out = { args: { model: null, prompt: "triage the flaky tests" } }
    await hooksA["tool.execute.before"]({ tool: "task" }, out)
    assert.equal(out.args.model, "deepseek/deepseek-chat")
  }

  const glPath = join(sandbox, ".claude/global-learning.json")
  assert.ok(existsSync(glPath), "global learning file created")
  const gl = JSON.parse(readFileSync(glPath, "utf-8"))
  assert.ok(gl.exploratory_words?.triage, "triage promoted into learned exploratory words")

  // Project B should reuse that learned word even on high tier, where the
  // default tier route would otherwise be brain->medium.
  const tiers2 = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf-8"))
  tiers2.selection.active_slot = "brain"
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify(tiers2))

  const projectB = join(sandbox, "proj-B")
  mkdirSync(projectB, { recursive: true })
  writeFileSync(join(projectB, "opencode.json"), JSON.stringify({ model: "openrouter/anthropic/claude-opus-4-7" }))
  const hooksB = await DelegationEnforcer({ client: {}, directory: projectB })
  const outB = { args: { model: null, prompt: "triage the release notes" } }
  await hooksB["tool.execute.before"]({ tool: "task" }, outB)
  assert.equal(outB.args.model, "deepseek/deepseek-chat",
    "learned exploratory routing should force cheap across projects")
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: trinity rebuild helpers — classifyAndRankModels, modelToCcAlias
// ════════════════════════════════════════════════════════════════════════════

test("classifyAndRankModels: deepseek-only ranked brain>medium>cheap", async () => {
  const { classifyAndRankModels } = await import("../src/index.js?t=" + Date.now())
  const models = [
    { id: "deepseek/deepseek-chat",     provider: "deepseek", cost: 0,       tier: "budget" },
    { id: "deepseek/deepseek-v4-flash", provider: "deepseek", cost: 0.0001,  tier: "mid" },
    { id: "deepseek/deepseek-v4-pro",   provider: "deepseek", cost: 0.0003,  tier: "high" },
  ]
  const result = classifyAndRankModels(models)
  assert.ok(result, "result not null")
  assert.equal(result.brain.id, "deepseek/deepseek-v4-pro",   "brain = v4-pro (high tier, highest cost)")
  assert.equal(result.medium.id, "deepseek/deepseek-v4-flash", "medium = v4-flash (mid tier)")
  assert.equal(result.cheap.id, "deepseek/deepseek-chat",      "cheap = chat (budget, lowest cost)")
})

test("classifyAndRankModels: single model → all slots same", async () => {
  const { classifyAndRankModels } = await import("../src/index.js?t=" + Date.now())
  const models = [
    { id: "deepseek/deepseek-chat", provider: "deepseek", cost: 0, tier: "budget" },
  ]
  const result = classifyAndRankModels(models)
  assert.ok(result, "result not null")
  assert.equal(result.brain.id, "deepseek/deepseek-chat")
  assert.equal(result.medium.id, "deepseek/deepseek-chat")
  assert.equal(result.cheap.id, "deepseek/deepseek-chat")
})

test("classifyAndRankModels: mid+tier ranked correctly (no high)", async () => {
  const { classifyAndRankModels } = await import("../src/index.js?t=" + Date.now())
  const models = [
    { id: "deepseek/deepseek-chat",     provider: "deepseek", cost: 0,       tier: "budget" },
    { id: "deepseek/deepseek-v4-flash", provider: "deepseek", cost: 0.0001,  tier: "mid" },
  ]
  const result = classifyAndRankModels(models)
  assert.ok(result, "result not null")
  assert.equal(result.brain.id, "deepseek/deepseek-v4-flash", "brain = v4-flash (only mid-tier)")
  assert.equal(result.medium.id, "deepseek/deepseek-chat", "medium = chat (second strongest)")
  assert.equal(result.cheap.id, "deepseek/deepseek-chat", "cheap = chat (cheapest)")
})

test("classifyAndRankModels: dedup by id", async () => {
  const { classifyAndRankModels } = await import("../src/index.js?t=" + Date.now())
  const models = [
    { id: "deepseek/deepseek-chat", provider: "deepseek", cost: 0, tier: "budget" },
    { id: "deepseek/deepseek-chat", provider: "opencode", cost: 0, tier: "budget" }, // duplicate
    { id: "deepseek/deepseek-v4-pro", provider: "deepseek", cost: 0.0003, tier: "high" },
  ]
  const result = classifyAndRankModels(models)
  assert.ok(result, "result not null")
  assert.equal(result.brain.id, "deepseek/deepseek-v4-pro", "brain = v4-pro")
  assert.equal(result.cheap.id, "deepseek/deepseek-chat", "cheap = chat")
})

test("classifyAndRankModels: null/empty → null", async () => {
  const { classifyAndRankModels } = await import("../src/index.js?t=" + Date.now())
  assert.equal(classifyAndRankModels(null), null)
  assert.equal(classifyAndRankModels([]), null)
})

test("modelToCcAlias: deepseek models map correctly", async () => {
  const { modelToCcAlias } = await import("../src/index.js?t=" + Date.now())
  assert.equal(modelToCcAlias("deepseek/deepseek-v4-pro"), "deepseek-reasoner")
  assert.equal(modelToCcAlias("deepseek/deepseek-v4-flash"), "haiku")
  assert.equal(modelToCcAlias("deepseek/deepseek-chat"), "haiku")
  assert.equal(modelToCcAlias("deepseek/deepseek-reasoner"), "deepseek-reasoner")
})

test("modelToCcAlias: sonnet models map to sonnet", async () => {
  const { modelToCcAlias } = await import("../src/index.js?t=" + Date.now())
  assert.equal(modelToCcAlias("openrouter/anthropic/claude-sonnet-4.6"), "sonnet")
  assert.equal(modelToCcAlias("claude-sonnet-4.6"), "sonnet")
})

test("modelToCcAlias: unknown model returns haiku", async () => {
  const { modelToCcAlias } = await import("../src/index.js?t=" + Date.now())
  assert.equal(modelToCcAlias("unknown/model-xyz"), "haiku")
  assert.equal(modelToCcAlias(""), "haiku")
  assert.equal(modelToCcAlias(null), "haiku")
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: applySlot config file integrity
// ════════════════════════════════════════════════════════════════════════════

test("applySlot: preserves model-tiers.json selection/tiers/pricing blocks", async () => {
  let origHome = process.env.HOME
  process.env.HOME = sandbox
  const { DelegationEnforcer, applySlot } = await loadPlugin()
  const dir = join(sandbox, ".opencode-applyslot1")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))

  const tiersFile = join(sandbox, ".claude/model-tiers.json")
  writeFileSync(tiersFile, JSON.stringify({
    selection: { enabled: true, active_slot: "medium", thinking_level: "off", flow_enabled: true, monthly_budget_usd: 50 },
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-chat", cc: "haiku" },
    },
    tiers: {
      high:   { regex: "opus|deepseek.*v4.*pro|gpt-5" },
      mid:    { regex: "claude.*sonnet|deepseek.*v4.*flash" },
      budget: { regex: ".*" },
    },
    pricing: {
      deepseek: { chat: 0, "v4-flash": 0.0001, "v4-pro": 0.0003 },
      openrouter: {},
    },
  }))

  //   let origHome = process.env.HOME
  process.env.HOME = sandbox
  try {
    const hooks = await DelegationEnforcer({ client: {}, directory: dir })
    const result = applySlot("brain")
    assert.ok(result.ok, `applySlot returned ok: ${JSON.stringify(result)}`)
  } finally {
    process.env.HOME = origHome
  }

  // Verify model-tiers.json is fully preserved
  const after = JSON.parse(readFileSync(tiersFile, "utf-8"))
  assert.equal(after.selection.active_slot, "brain", "active_slot updated to brain")
  assert.equal(after.selection.enabled, true, "selection.enabled preserved")
  assert.equal(after.selection.thinking_level, "off", "selection.thinking_level preserved")
  assert.equal(after.selection.flow_enabled, true, "selection.flow_enabled preserved")
  assert.equal(after.selection.monthly_budget_usd, 50, "selection.monthly_budget_usd preserved")
  assert.equal(after.tiers.high.regex, "opus|deepseek.*v4.*pro|gpt-5", "tiers.high preserved")
  assert.equal(after.tiers.mid.regex, "claude.*sonnet|deepseek.*v4.*flash", "tiers.mid preserved")
  assert.equal(after.tiers.budget.regex, ".*", "tiers.budget preserved")
  assert.equal(after.pricing.deepseek.chat, 0, "pricing.deepseek.chat preserved")
  assert.equal(after.pricing.deepseek["v4-pro"], 0.0003, "pricing.deepseek.v4-pro preserved")
  assert.equal(after.trinity.brain.oc, "deepseek/deepseek-v4-pro", "trinity.brain preserved")
  process.env.HOME = origHome
})

test("applySlot: preserves opencode.json all fields (only model changes)", async () => {
  let origHome = process.env.HOME
  process.env.HOME = sandbox
  const { DelegationEnforcer, applySlot } = await loadPlugin()
  const dir = join(sandbox, ".opencode-applyslot2")
  mkdirSync(dir, { recursive: true })

  // Write opencode.json with full realistic content
  const ocConfigDir = join(sandbox, ".config/opencode")
  mkdirSync(ocConfigDir, { recursive: true })
  const ocConfigPath = join(ocConfigDir, "opencode.json")
  writeFileSync(ocConfigPath, JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    "instructions": ["~/.config/opencode/AGENTS.md"],
    "plugin": ["./plugins/vibeOS"],
    "model": "deepseek/deepseek-v4-flash",
    "mcp": {
      "context7": {
        "type": "local",
        "command": ["node", "context7-mcp"]
      }
    },
    "provider": {
      "opencode": {},
      "deepseek": {
        "models": {
          "deepseek-v4-pro": {},
          "deepseek-v4-flash": {},
          "deepseek-chat": {},
          "deepseek-reasoner": {}
        }
      }
    }
  }))

  // model-tiers must exist with trinity block
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-chat", cc: "haiku" },
    },
    selection: { enabled: true, active_slot: "medium" },
    tiers: { high: { regex: "." }, mid: { regex: "." }, budget: { regex: "." } },
  }))

  const result = applySlot("brain")
  assert.ok(result.ok, `applySlot returned ok: ${JSON.stringify(result)}`)

  const after = JSON.parse(readFileSync(ocConfigPath, "utf-8"))
  assert.equal(after.model, "deepseek/deepseek-v4-pro", "model updated to brain slot")
  assert.equal(after["$schema"], "https://opencode.ai/config.json", "schema preserved")
  assert.deepEqual(after.provider, {
    opencode: {},
    deepseek: {
      models: {
        "deepseek-v4-pro": {},
        "deepseek-v4-flash": {},
        "deepseek-chat": {},
        "deepseek-reasoner": {}
      }
    }
  }, "provider models fully preserved — models not deleted from dropdown")
  assert.deepEqual(after.mcp.context7.command, ["node", "context7-mcp"], "mcp preserved")
  assert.deepEqual(after.plugin, ["./plugins/vibeOS"], "plugin list preserved")
  process.env.HOME = origHome
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: Welcome banner injection via system.transform
// ════════════════════════════════════════════════════════════════════════════

test("system.transform: welcome banner injected once per project", async () => {
  // Write a proper model-tiers.json so the banner reads active slot
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-chat", cc: "haiku" },
    },
    selection: { enabled: true, active_slot: "medium" },
    tiers: { high: { regex: "." }, mid: { regex: "." }, budget: { regex: "." } },
  }))

  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-welcome")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const out1 = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out1)
  const hasWelcome = out1.system.some(s => typeof s === "string" && s.includes("vibeOS") && s.includes("trinity help"))
  assert.ok(hasWelcome, "welcome banner present in first call: " + JSON.stringify(out1.system))

  // Second call for same project → banner NOT injected again (one-shot)
  const out2 = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out2)
  const hasWelcome2 = out2.system.some(s => typeof s === "string" && s.includes("vibeOS") && s.includes("trinity help"))
  assert.ok(!hasWelcome2, "welcome banner NOT re-injected on second call")
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: Auto-save session reports every 5 messages
// ════════════════════════════════════════════════════════════════════════════

test("text.complete: auto-saves report every 5 messages", async () => {
  let origHome = process.env.HOME
  process.env.HOME = sandbox
  const { DelegationEnforcer, listReports } = await loadPlugin()
  const dir = join(sandbox, ".opencode-autosave")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  writeFileSync(join(sandbox, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { warn_count: 5, scratchpad_hits_observed: 3, missed_context7_usd: 0.01, last_updated: "now" },
    sessions: {
      ["test-session-" + process.pid]: {
        warns: [{ est_savings_usd: 0.10, reason: "direct edit proxy" }],
        cache_savings_usd: 0.50,
        cost_usd: 0.12,
      }
    }
  }))

  // Call text.complete 5 times with unique messageIDs
    for (let i = 1; i <= 5; i++) {
      await hooks["experimental.text.complete"]({ messageID: "auto-msg-" + i }, { text: "Ok." })
    }

    // Check that a session report was auto-saved
    const { readReport } = await import("../src/index.js?t=" + Date.now())
    const allReps = listReports({ hours: 999 })
    assert.ok(allReps.length >= 1, "at least 1 total report exists, got " + allReps.length)
    const reports = listReports({ type: "session", hours: 999 })
    assert.ok(reports.length >= 1, "session report exists, got " + reports.length)
    if (reports.length > 0) {
      const id = reports[0].id
      const full = readReport(id)
      assert.ok(full, "report readable")
      assert.ok(full.summary.includes("Session cost") || full.summary.includes("saved"),
        "report summary shows cost/savings: " + full.summary)
      assert.ok(full.tags && full.tags.includes("auto"),
        "report tagged as auto-generated")
    }
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: report-list and report-read show cost breakdown
// ════════════════════════════════════════════════════════════════════════════

test("report-list/read: auto-report shown with cost/savings metrics", async () => {
  const { DelegationEnforcer, saveReport, listReports, readReport } = await loadPlugin()
  const dir = join(sandbox, ".opencode-reportfmt")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Manually save a session report with the same format as auto-save
  const id = saveReport({
    type: "session",
    summary: "Session cost: $0.42 | saved: $1.80 | 12 tasks",
    metrics: {
      sessionCost: 0.42,
      cacheSavings: 1.80,
      tasksDelegated: 12,
      model: "deepseek/deepseek-v4-pro",
      slot: "brain",
      editSavings: 0.05,
      creditSavings: 0.10,
      context7Savings: 0.03,
    },
    tags: ["auto", "cost"],
  })
  assert.ok(id, "report saved")

  // listReports should include it
  const reports = listReports({ type: "session", hours: 1 })
  assert.ok(reports.length >= 1, "report appears in list")
  const found = reports.find(r => r.id === id)
  assert.ok(found, "saved report found in list")
  assert.ok(found.summary.includes("$0.42"), "list shows cost: " + found.summary)

  // readReport should show metrics breakdown
  const full = readReport(id)
  assert.ok(full, "report readable")
  assert.equal(full.metrics.sessionCost, 0.42, "metrics.sessionCost")
  assert.equal(full.metrics.cacheSavings, 1.80, "metrics.cacheSavings")
  assert.equal(full.metrics.tasksDelegated, 12, "metrics.tasksDelegated")
  assert.equal(full.metrics.model, "deepseek/deepseek-v4-pro", "metrics.model")
  assert.equal(full.metrics.slot, "brain", "metrics.slot")
})

// ════════════════════════════════════════════════════════════════════════════
// NEW: Probe model — verify API endpoint resolution
// ════════════════════════════════════════════════════════════════════════════

test("probeModel: opencode models skipped (assumed ok)", { skip: "requires mocking fetch" }, () => {})

test("discoverAvailableModels: deepseek models from provider config", { skip: "requires API access" }, () => {})

// ════════════════════════════════════════════════════════════════════════════
// TDD Enforcement — skeleton creation, lock, cooldown, recursion guard
// ════════════════════════════════════════════════════════════════════════════

test("buildTestSkeleton: .py file returns correct path and content", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const s = buildTestSkeleton("/proj/src/utils.py")
  assert.ok(s, "skeleton generated")
  assert.ok(s.path.endsWith("tests/test_utils.py"), `path: ${s.path}`)
  assert.ok(s.content.includes("[vibeOS-enforced]"), "enforced marker present")
  assert.ok(s.content.includes("AssertionError"), "strict incomplete marker present")
  assert.ok(s.content.includes("from utils import"), "module import present")
})

test("buildTestSkeleton: .py file extracts exports from source", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const source = `def snake_case(name): pass\ndef truncate(s, max_len=80): pass\nclass StringHelper: pass`
  const s = buildTestSkeleton("/proj/src/utils.py", source, { strict: false, quality: false })
  assert.ok(s, "skeleton generated")
  assert.ok(s.content.includes("from utils import snake_case, truncate, StringHelper"), "exports imported")
      assert.ok(s.content.includes("test_should_snake_case_with_valid_input"), "test case generated")
      assert.ok(s.content.includes("test_should_truncate_with_valid_input"), "test case generated")
})

test("buildTestSkeleton: .ts file returns correct path and content", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const s = buildTestSkeleton("/proj/src/handler.ts")
  assert.ok(s, "skeleton generated")
  assert.ok(s.path.endsWith("tests/handler.test.ts"), `path: ${s.path}`)
  assert.ok(s.content.includes("TODO: implement"), "incomplete marker present")
  assert.ok(s.content.includes("toBeDefined()"), "module check present")
})

test("buildTestSkeleton: .ts file extracts exports from source", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const source = `export function handler(event: Event): Response { return { status: 200 } }\nexport function middleware(req: Request): void { log(req) }`
  const s = buildTestSkeleton("/proj/src/handler.ts", source, { strict: false, quality: false })
  assert.ok(s, "skeleton generated")
  assert.ok(s.content.includes("it('should handler with valid input'"), "test case generated")
  assert.ok(s.content.includes("it('should middleware with valid input'"), "test case generated")
})

test("buildTestSkeleton: .go file returns correct path and content", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const s = buildTestSkeleton("/proj/src/server.go")
  assert.ok(s, "skeleton generated")
  assert.ok(s.path.endsWith("server_test.go"), `path: ${s.path}`)
    assert.ok(s.content.includes("t.Error"), "strict incomplete marker present")
})

test("buildTestSkeleton: strict mode controls TODO behavior", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const source = `export function sum(a,b){ return a+b }\n`
  const strict = buildTestSkeleton("/proj/src/sum.js", source, { strict: true })
  const nonStrict = buildTestSkeleton("/proj/src/sum.js", source, { strict: false })
  assert.ok(strict.content.includes("throw new Error('TODO: implement"), "strict skeleton must fail loudly")
  assert.ok(nonStrict.content.includes("expect(true).toBe(true)"), "non-strict skeleton should be non-blocking")
})

test("buildTestSkeleton: .go file extracts exports from source", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const source = `func ServeHTTP(w http.ResponseWriter, r *http.Request) {}\nfunc NewServer(addr string) *Server { return &Server{} }`
  const s = buildTestSkeleton("/proj/src/server.go", source, { strict: false, quality: false })
  assert.ok(s, "skeleton generated")
  assert.ok(s.content.includes("TestServer_should_ServeHTTP_with_valid_input"), "test case generated")
  assert.ok(s.content.includes("TestServer_should_NewServer_with_valid_input"), "test case generated")
})

test("buildTestSkeleton: .rs file returns correct path and content", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const s = buildTestSkeleton("/proj/src/lib.rs")
  assert.ok(s, "skeleton generated")
  assert.ok(s.path.endsWith("tests/lib_test.rs"), `path: ${s.path}`)
  assert.ok(s.content.includes('panic!("TODO'), "incomplete marker present")
})

test("buildTestSkeleton: .rs file extracts exports from source", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  const source = `pub fn init() -> i32 { 0 }\npub fn render(t: &str) -> String { t.to_string() }`
  const s = buildTestSkeleton("/proj/src/lib.rs", source, { strict: false, quality: false })
  assert.ok(s, "skeleton generated")
  assert.ok(s.content.includes("test_should_init_with_valid_input"), "test case generated")
})

test("buildTestSkeleton: test file itself → null", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  assert.equal(buildTestSkeleton("/proj/tests/test_utils.py"), null)
  assert.equal(buildTestSkeleton("/proj/src/utils.test.ts"), null)
})

test("buildTestSkeleton: non-source extension → null", async () => {
  const { buildTestSkeleton } = await loadPlugin()
  assert.equal(buildTestSkeleton("/proj/README.md"), null)
  assert.equal(buildTestSkeleton("/proj/config.json"), null)
})

test("enforceTestFile: creates skeleton when test missing", async () => {
  const sb = mkdtempSync(join(tmpdir(), "tdd-enforce-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  writeFileSync(join(sb, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, tdd_strict: false, tdd_quality: false },
  }))
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { enforceTestFile } = await loadPlugin()
    const srcDir = join(sb, "proj/src")
    mkdirSync(srcDir, { recursive: true })
    const srcFile = join(srcDir, `calc-${Date.now()}.py`)
    writeFileSync(srcFile, "def add(a, b): return a + b\ndef subtract(a, b): return a - b")
    const created = enforceTestFile(srcFile)
    assert.ok(created, "skeleton created")
    assert.ok(existsSync(created), "file exists on disk")
    const content = readFileSync(created, "utf-8")
    assert.ok(content.includes("[vibeOS-enforced]"), "enforced marker in file")
    assert.ok(content.includes("pytest.skip"), "non-strict skip marker in file")
    assert.ok(content.includes("from calc"), "module import present")
    assert.ok(content.includes("test_should_add_with_valid_input"), "test case for add")
    assert.ok(content.includes("test_should_subtract_with_valid_input"), "test case for subtract")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("enforceTestFile: skips when test already exists", async () => {
  const sb = mkdtempSync(join(tmpdir(), "tdd-skip-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const srcDir = join(sb, "proj/src")
    const testDir = join(srcDir, "tests")
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    const ts = Date.now()
    const srcFile = join(srcDir, `skip-${ts}.py`)
    const testFile = join(testDir, `test_skip-${ts}.py`)
    writeFileSync(srcFile, "def foo(): pass")
    writeFileSync(testFile, "def test_foo(): assert True")
    const { enforceTestFile } = await loadPlugin()
    const created = enforceTestFile(srcFile)
    assert.equal(created, null, "no skeleton created when test exists")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("enforceTestFile: dedup — second call for same file returns null", async () => {
  const sb = mkdtempSync(join(tmpdir(), "tdd-dedup-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { enforceTestFile } = await loadPlugin()
    const srcDir = join(sb, "proj/src")
    mkdirSync(srcDir, { recursive: true })
    const srcFile = join(srcDir, `dedup-${Date.now()}.py`)
    writeFileSync(srcFile, "def bar(): pass")
    const first = enforceTestFile(srcFile)
    assert.ok(first, "first call creates skeleton")
    const second = enforceTestFile(srcFile)
    assert.equal(second, null, "second call returns null (file exists)")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("enforceTestFile: records tdd_enforced count in state file", async () => {
  const sb = mkdtempSync(join(tmpdir(), "tdd-state-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { enforceTestFile } = await loadPlugin()
    const srcDir = join(sb, "proj/src")
    mkdirSync(srcDir, { recursive: true })
    const srcFile = join(srcDir, `state-${Date.now()}.py`)
    writeFileSync(srcFile, "def baz(): pass")
    enforceTestFile(srcFile)
    const stateFile = join(sb, ".claude/delegation-state.json")
    assert.ok(existsSync(stateFile), "state file created")
    const state = JSON.parse(readFileSync(stateFile, "utf-8"))
    assert.equal(state.lifetime.tdd_enforced, 1, "tdd_enforced = 1")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("tdd-enforce gate: skips skeleton without explicit test intent, creates with explicit test intent", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "medium", tdd_enforce: true, tdd_strict: true, tdd_quality: true },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" },
    },
  }))
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-tdd-intent")
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const srcFile = join(dir, "src", "gate-worker.js")
  const testFile = join(dir, "src", "tests", "gate-worker.test.js")
  writeFileSync(srcFile, "module.exports = { run: () => 1 };\n")
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // No explicit test intent yet.
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: srcFile } },
    { result: "ok" }
  )
  assert.equal(existsSync(testFile), false, "should not auto-create skeleton without explicit test intent")

  // Provide explicit test intent through latest user request capture.
  await hooks["experimental.chat.system.transform"](
    { role: "user", content: "Add tests for gate-worker.js and run regression checks." },
    { system: [] }
  )
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: srcFile } },
    { result: "ok" }
  )
  assert.equal(existsSync(testFile), true, "should auto-create skeleton when user explicitly asks for tests")
})

// ════════════════════════════════════════════════════════════════════════════
// Flow Enforcement — TODO extraction
// ════════════════════════════════════════════════════════════════════════════

test("recordFlowTodo: extracts TODO/FIXME from content", async () => {
  const sb = mkdtempSync(join(tmpdir(), "flow-todo-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { recordFlowTodo, resetForTest } = await import("../src/vibeOS-lib/flow-enforcer.js?t=" + Date.now())
    resetForTest([])
    const count = recordFlowTodo({
      filePath: "src/foo.js",
      content: "// TODO: fix this later\n// FIXME: broken\nconst x = 1; // HACK: workaround",
    })
    assert.equal(count, 3, "3 TODOs extracted")
    const todoFile = join(sb, ".claude/flow-todo-queue.jsonl")
    assert.ok(existsSync(todoFile), "todo queue created")
    const lines = readFileSync(todoFile, "utf-8").trim().split("\n").filter(Boolean)
    assert.equal(lines.length, 1, "one entry written")
    const entry = JSON.parse(lines[0])
    assert.equal(entry.filePath, "src/foo.js")
    assert.equal(entry.todos.length, 3)
    assert.equal(entry.todos[0].type, "TODO")
    assert.equal(entry.todos[1].type, "FIXME")
    assert.equal(entry.todos[2].type, "HACK")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("recordFlowTodo: returns 0 when no TODOs in content", async () => {
  const sb = mkdtempSync(join(tmpdir(), "flow-todo-empty-"))
  mkdirSync(join(sb, ".claude/scratch"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb
  try {
    const { recordFlowTodo, resetForTest } = await import("../src/flow-enforcer.js?t=" + Date.now())
    resetForTest([])
    const count = recordFlowTodo({
      filePath: "src/clean.js",
      content: "const x = 1;\nfunction foo() { return x; }",
    })
    assert.equal(count, 0, "no TODOs found")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Trinity tdd/flow enforce commands
// ════════════════════════════════════════════════════════════════════════════

test("trinity tdd: enable/disable enforcement", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-tdd-cmd")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "haiku" } },
    selection: { enabled: true, tdd_enforce: false },
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const t = hooks.tool.trinity
  // Default: off
  const status = await t.execute({ action: "status" })
  assert.ok(status.includes("OFF (nudge only)"), "tdd default off: " + status)
  // Enable
  const enable = await t.execute({ action: "tdd", slot: "on" })
  assert.ok(enable.includes("ENABLED"), "tdd enable: " + enable)
  // Verify in status
  const status2 = await t.execute({ action: "status" })
  assert.ok(status2.includes("ON (auto-create skeletons)"), "tdd now on: " + status2)
  // Disable
  const disable = await t.execute({ action: "tdd", slot: "off" })
  assert.ok(disable.includes("DISABLED"), "tdd disable: " + disable)
})

test("trinity tdd strict: defaults ON and toggles on/off", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-tdd-strict")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "haiku" } },
    selection: { enabled: true, tdd_enforce: true },
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const t = hooks.tool.trinity
  const status = await t.execute({ action: "status" })
  assert.ok(status.includes("TDD strict: ON"), "default strict ON in status: " + status)
  const off = await t.execute({ action: "tdd", slot: "strict", level: "off" })
  assert.ok(off.includes("DISABLED"), "strict off message: " + off)
  const status2 = await t.execute({ action: "status" })
  assert.ok(status2.includes("TDD strict: OFF"), "strict OFF in status: " + status2)
  const on = await t.execute({ action: "tdd", slot: "strict", level: "on" })
  assert.ok(on.includes("ENABLED"), "strict on message: " + on)
})

test("trinity flow: enable/disable enforcement", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-flow-cmd")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "haiku" } },
    selection: { enabled: true, flow_enforce: false },
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const t = hooks.tool.trinity
  const enable = await t.execute({ action: "flow", slot: "enforce", level: "on" })
  assert.ok(enable.includes("ENABLED"), "flow enforce on: " + enable)
  const status = await t.execute({ action: "status" })
  assert.ok(status.includes("ON (auto-extract TODOs)"), "flow enforce in status: " + status)
  const disable = await t.execute({ action: "flow", slot: "enforce", level: "off" })
  assert.ok(disable.includes("DISABLED"), "flow enforce off: " + disable)
})

test("trinity tdd: audit shows stats", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-tdd-audit")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "haiku" } },
    selection: { enabled: true, tdd_enforce: false },
    lifetime: { tdd_enforced: 5 },
  }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const t = hooks.tool.trinity
  const audit = await t.execute({ action: "tdd" })
  assert.ok(audit.includes("TDD enforcer"), "tdd audit: " + audit)
  assert.ok(audit.includes("NUDGE") || audit.includes("ENFORCE"), "mode shown")
})

test("trinity repair-state: preview and apply merge duplicate fingerprints safely", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-repair")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "brain" },
    trinity: { brain: { oc: "haiku" } },
  }))

  const { createHash } = await import("node:crypto")
  const dstFp = createHash("sha256").update(dir).digest("hex").slice(0, 12)
  const srcFp = "8a5edab28263"
  writeFileSync(join(sandbox, ".claude/project-states.json"), JSON.stringify({
    project_hashes: {
      [dstFp]: { totalSessions: 2, researchChains: 1, context7Bypasses: 0, commonTopics: ["a.dev"], lastSeen: "2026-05-17T07:00:00.000Z" },
      [srcFp]: { totalSessions: 3, researchChains: 4, context7Bypasses: 2, commonTopics: ["b.dev"], lastSeen: "2026-05-17T08:00:00.000Z" },
    }
  }))
  mkdirSync(join(sandbox, ".claude/reports"), { recursive: true })
  writeFileSync(join(sandbox, ".claude/reports/index.json"), JSON.stringify({
    reports: [
      { id: "r1", type: "manual", project: ".opencode-repair", fingerprint: srcFp, created: "2026-05-17T08:10:00.000Z", summary: "x" },
      { id: "r2", type: "manual", project: ".opencode-repair", fingerprint: dstFp, created: "2026-05-17T08:20:00.000Z", summary: "y" },
    ]
  }))
  writeFileSync(join(sandbox, ".claude/reports/r1.json"), JSON.stringify({
    meta: { id: "r1", project: ".opencode-repair", fingerprint: srcFp, type: "manual", created: "2026-05-17T08:10:00.000Z", sessionId: "opencode-1" },
    summary: "x", findings: [], metrics: {}, narrative: "", tags: []
  }))

  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const t = hooks.tool.trinity
  const preview = await t.execute({ action: "repair-state", slot: "preview" })
  assert.ok(preview.includes("State repair (preview)"), preview)
  assert.ok(preview.includes(srcFp), preview)

  const applied = await t.execute({ action: "repair-state", slot: "apply" })
  assert.ok(applied.includes("Applied"), applied)

  const afterState = JSON.parse(readFileSync(join(sandbox, ".claude/project-states.json"), "utf-8"))
  assert.ok(afterState.project_hashes[dstFp], "target fp exists")
  assert.equal(afterState.project_hashes[srcFp], undefined, "source fp removed")
  assert.equal(afterState.project_hashes[dstFp].totalSessions, 6, "sessions merged (includes current init session)")
  assert.equal(afterState.project_hashes[dstFp].researchChains, 4, "research chains merged by max")
  assert.equal(afterState.project_hashes[dstFp].context7Bypasses, 2, "bypasses merged by sum")

  const afterIndex = JSON.parse(readFileSync(join(sandbox, ".claude/reports/index.json"), "utf-8"))
  assert.equal(afterIndex.reports.filter(r => r.fingerprint === srcFp).length, 0, "source fingerprint removed from index")
  assert.ok(afterIndex.reports.some(r => r.id === "r1" && r.fingerprint === dstFp), "index relabeled to target fingerprint")
})
