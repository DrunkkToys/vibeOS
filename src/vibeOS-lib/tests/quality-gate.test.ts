import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const gate = await import("../quality-gate.js?test=" + Date.now())

function ev(overrides = {}) {
  return {
    tool: "bash",
    role: "query",
    family: "unknown",
    at: 1000,
    exitCode: null,
    isFailed: false,
    ...overrides,
  }
}

test("quality-gate: extractClaims finds state, action and done claims", () => {
  const claims = gate.extractClaims("All 5 tests pass.\nI fixed the bug in queue.ts.\nDone.")
  const kinds = claims.map((c) => c.kind)
  assert.ok(kinds.includes("state"), `expected state claim, got ${kinds}`)
  assert.ok(kinds.includes("action"), `expected action claim, got ${kinds}`)
  assert.ok(kinds.includes("done"), `expected done claim, got ${kinds}`)
})

test("quality-gate: test claim without an exit-0 verification run FAILS", () => {
  const events = [ev({ role: "mutation", tool: "write", family: "edit", at: 100 }) ]
  const verdict = gate.runQualityGate({
    text: "All tests pass, ready to merge.",
    events,
    recentTools: [{ tool: "write", target: "src/foo.ts", at: 100 }],
  })
  assert.equal(verdict.passed, false)
  assert.ok(verdict.missing.some((m) => /tests\/build claimed/.test(m)))
})

test("quality-gate: test claim WITH a real exit-0 verification run PASSES", () => {
  const events = [
    ev({ role: "mutation", tool: "write", family: "edit", at: 100 }),
    ev({ role: "verification", family: "npm test", at: 200, exitCode: 0 }),
  ]
  const verdict = gate.runQualityGate({
    text: "All tests pass.",
    events,
    recentTools: [],
  })
  assert.equal(verdict.passed, true)
})

test("quality-gate: source change without a test step FAILS on code flow", () => {
  const verdict = gate.runQualityGate({
    text: "I refactored payment.ts, done.",
    events: [ev({ role: "mutation", tool: "write", family: "edit", at: 100 })],
    recentTools: [{ tool: "edit", target: "src/payment.ts", at: 100 }],
  })
  assert.equal(verdict.passed, false)
  assert.ok(verdict.missing.some((m) => /test step/.test(m)))
  assert.equal(verdict.flow, "code")
})

test("quality-gate: source change with a touched test file PASSES", () => {
  const verdict = gate.runQualityGate({
    text: "I refactored payment.ts and updated the tests.",
    events: [ev({ role: "mutation", tool: "write", family: "edit", at: 100 })],
    recentTools: [
      { tool: "edit", target: "src/payment.ts", at: 100 },
      { tool: "write", target: "tests/payment.test.ts", at: 110 },
    ],
  })
  assert.equal(verdict.passed, true)
})

test("quality-gate: non-code action claim without a post-change verification FAILS", () => {
  const verdict = gate.runQualityGate({
    text: "I updated the README with the new API docs.",
    events: [ev({ role: "mutation", tool: "write", family: "edit", at: 100 })],
    recentTools: [{ tool: "write", target: "README.md", at: 100 }],
  })
  assert.equal(verdict.passed, false)
  assert.ok(verdict.missing.some((m) => /no verification iteration/.test(m)))
})

test("quality-gate: non-code action claim WITH a later verification PASSES", () => {
  const verdict = gate.runQualityGate({
    text: "I updated the README with the new API docs.",
    events: [
      ev({ role: "mutation", tool: "write", family: "edit", at: 100 }),
      ev({ role: "verification", family: "git diff", at: 200, exitCode: 0 }),
    ],
    recentTools: [{ tool: "write", target: "README.md", at: 100 }],
  })
  assert.equal(verdict.passed, true)
})

test("quality-gate: no claims and no work → pass (silent)", () => {
  const verdict = gate.runQualityGate({ text: "Here is the analysis summary.", events: [], recentTools: [] })
  assert.equal(verdict.passed, true)
})

test("quality-gate: formatGateReport is empty on pass and lists missing on fail", () => {
  const pass = gate.runQualityGate({ text: "All tests pass.", events: [ev({ role: "verification", family: "npm test", exitCode: 0 })], recentTools: [] })
  assert.equal(gate.formatGateReport(pass), "")
  const fail = gate.runQualityGate({ text: "All tests pass.", events: [], recentTools: [] })
  assert.ok(gate.formatGateReport(fail).includes("[quality-gate]"))
  assert.ok(gate.formatGateReport(fail).includes("tests/build claimed"))
})

test("quality-gate: recordGateVerdict + readGateEvents round-trip under a temp home", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-gate-"))
  const ok = gate.recordGateVerdict(home, "sess-test", gate.runQualityGate({ text: "All tests pass.", events: [], recentTools: [] }))
  assert.equal(ok, true)
  const file = join(home, "quality-gate", "sess-test.jsonl")
  assert.equal(existsSync(file), true)
})

test("quality-gate: readGateVerdicts + readLatestGateVerdict round-trip", () => {
  const home = mkdtempSync(join(tmpdir(), "vibeos-gate-"))
  gate.recordGateVerdict(home, "sess-v", gate.runQualityGate({ text: "All tests pass.", events: [], recentTools: [] }))
  gate.recordGateVerdict(home, "sess-v", gate.runQualityGate({ text: "I fixed queue.ts, done.", events: [ev({ role: "mutation", tool: "edit", family: "edit", at: 1 })], recentTools: [{ tool: "edit", target: "src/queue.ts", at: 1 }] }))
  const all = gate.readGateVerdicts(home, "sess-v", 10)
  assert.equal(all.length, 2)
  const last = gate.readLatestGateVerdict(home, "sess-v")
  assert.equal(last.passed, false)
  assert.ok(last.missing.some((m) => /test step/.test(m)))
})

test("quality-gate: gate verdict maps to a deterministic outcome signal", () => {
  const pass = gate.runQualityGate({ text: "All tests pass.", events: [ev({ role: "verification", family: "npm test", exitCode: 0 })], recentTools: [] })
  const fail = gate.runQualityGate({ text: "All tests pass.", events: [], recentTools: [] })
  assert.equal(pass.passed ? "positive" : "negative", "positive")
  assert.equal(fail.passed ? "positive" : "negative", "negative")
})

test("quality-gate: a bare 'Done.' after editing source triggers the test-step rule", () => {
  const verdict = gate.runQualityGate({
    text: "Done.",
    events: [ev({ role: "mutation", tool: "edit", family: "edit", at: 1 })],
    recentTools: [{ tool: "edit", target: "src/queue.ts", at: 1 }],
  })
  assert.equal(verdict.passed, false)
  assert.ok(verdict.missing.some((m) => /test step/.test(m)))
})

test("quality-gate: filenames containing 'test' as a substring are NOT test files", () => {  const contest = gate.runQualityGate({
    text: "Done.",
    events: [ev({ role: "mutation", tool: "edit", family: "edit", at: 1 })],
    recentTools: [{ tool: "edit", target: "src/contest.ts", at: 1 }],
  })
  assert.equal(contest.passed, false, "contest.ts is a source file → test step required")
  const latest = gate.runQualityGate({
    text: "Done.",
    events: [ev({ role: "mutation", tool: "edit", family: "edit", at: 1 })],
    recentTools: [{ tool: "edit", target: "src/latest.ts", at: 1 }],
  })
  assert.equal(latest.passed, false, "latest.ts is a source file → test step required")
  const realTest = gate.runQualityGate({
    text: "Done.",
    events: [ev({ role: "mutation", tool: "write", family: "edit", at: 1 })],
    recentTools: [{ tool: "write", target: "tests/queue.test.ts", at: 1 }],
  })
  assert.equal(realTest.passed, true, "queue.test.ts is a real test file → test step satisfied")
})

test("quality-gate: bash-based source mutation still requires a test step", () => {
  const verdict = gate.runQualityGate({
    text: "Done.",
    events: [],
    recentTools: [{ tool: "bash", target: 'echo "export const FLAG = true" >> src/math.mjs', at: 1 }],
  })
  assert.equal(verdict.passed, false, "bash write to a source file must trigger the TDD rule")
  assert.ok(verdict.missing.some((m) => /test step/.test(m)), JSON.stringify(verdict.missing))
  const sedVerdict = gate.runQualityGate({
    text: "Done.",
    events: [],
    recentTools: [{ tool: "bash", target: "sed -i 's/42/43/' src/contest.mjs", at: 1 }],
  })
  assert.equal(sedVerdict.passed, false, "sed -i on a source file must trigger the TDD rule")
  const readOnly = gate.runQualityGate({
    text: "Done.",
    events: [],
    recentTools: [{ tool: "bash", target: "cat src/math.mjs", at: 1 }],
  })
  assert.equal(readOnly.passed, true, "read-only bash must not trigger the TDD rule")
})
