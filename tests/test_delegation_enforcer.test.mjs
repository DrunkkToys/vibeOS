// Unit tests for ~/.config/opencode/plugins/delegation-enforcer.js
// Run: ~/.nvm/versions/node/v23.11.0/bin/node --test tests/test_delegation_enforcer.test.mjs
//
// We import the plugin module and exercise its hooks against fake input/output
// objects. Each test runs in a tmpdir so the real shared state file is safe.

import { test, before, after } from "node:test"
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
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-budget")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "budget")
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
  // Dynamic estimate: opus brain cost (no worker model configured in sandbox)
  const expectedSaving = modelCostPerTurn("anthropic/claude-opus-4-7") ?? 0.07
  assert.ok(
    Math.abs(after.lifetime.est_savings_usd - (beforeSavings + expectedSaving)) < 0.001,
    `saving of $${expectedSaving} recorded, got delta ${after.lifetime.est_savings_usd - beforeSavings}`
  )
})

test("budget-tier tool calls don't record (only high tier enforces)", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-budgetenforce")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "haiku" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  const stateFile = join(sandbox, ".claude/delegation-state.json")
  const before = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : { lifetime: { warn_count: 0 } }
  const beforeCount = before?.lifetime?.warn_count || 0

  await hooks["tool.execute.before"]({ tool: "write" })
  await hooks["tool.execute.before"]({ tool: "edit" })

  const after = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : { lifetime: { warn_count: beforeCount } }
  assert.equal(after.lifetime.warn_count, beforeCount, "no warn recorded for budget tier")
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

  // Pre-seed state file so readLifetimeSavings returns >0
  const stateFile = join(sandbox, ".claude/delegation-state.json")
  writeFileSync(stateFile, JSON.stringify({
    lifetime: { warn_count: 5, est_savings_usd: 0.4, last_updated: "now" }
  }))

  const out = { text: "Done." }
  await hooks["experimental.text.complete"]({ messageID: "msg-1" }, out)
  // New format: "theSaver: $X.XX saved" — matches CC session-report-writer format
  assert.match(out.text, /theSaver: \$0\.40 saved/)
  assert.doesNotMatch(out.text, /tasks|events|ROI/, "verbose breakdown removed")
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

// ── tool.execute.after — output field ────────────────────────────────
test("tool.execute.after: compresses task output via output.result field", async () => {
  const { DelegationEnforcer } = await loadPlugin()
  const dir = join(sandbox, ".opencode-aftercomp")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4-7" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })

  // Build a long output that exceeds the 3000-char truncation threshold.
  // Plugin reads/writes output.result (not output.output).
  const longText = "A".repeat(3500)
  const out = { title: "task result", result: longText, metadata: {} }
  await hooks["tool.execute.after"]({ tool: "task", callID: "c1", args: {} }, out)
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
  assert.match(out.text, /Opus/, "model label shown even when no savings")
  assert.doesNotMatch(out.text, /saved/, "no savings line when count=0")
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
  assert.match(content, /theSaver:/, "report contains theSaver label")
  assert.match(content, /saved/, "report contains 'saved'")
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
  assert.match(lines[0], /theSaver:/, "log entry contains theSaver label")
})
