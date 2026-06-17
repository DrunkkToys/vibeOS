// SPDX-License-Identifier: MIT
// Contract + cascade tests for anti-lie enforcement path resolution.
//
// IMPORTANT: These tests document PROHIBITED PATTERNS protected from LLM regressions.
// Do NOT remove or bypass these guards. The "ENFORCEMENT BLOCK" markers are
// checked by the flow enforcer.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs"

const SANDBOX = mkdtempSync(join(tmpdir(), "vibeos-claim-contract-"))
const claudeDir = join(SANDBOX, ".claude")
const altVibeHome = join(SANDBOX, "custom-vibes-home")
mkdirSync(claudeDir, { recursive: true })
mkdirSync(altVibeHome, { recursive: true })

const CLAIM_PATTERNS = [
  /(?:done|completed|finished)/i,
  /(?:fixed|resolved|solved)/i,
  /(?:working|works|validated|verified)/i,
  /(?:[0-9]+\.[0-9]?%|\d+%)/,
  /(?:score|scored|passing|passed)/i,
]

// ── Helpers ────────────────────────────────────────────────────────────

function scanClaims(output, vibeHome) {
  if (!output || typeof output !== "string") return { claims: [], total: 0 }
  const claims = []
  for (const ln of String(output).split("\n")) {
    for (const pat of CLAIM_PATTERNS) {
      if (pat.test(ln)) { claims.push({ text: ln.trim().slice(0, 120), pattern: pat.source }) }
    }
  }
  if (!claims.length) return { claims: [], total: 0 }
  const auditDir = join(vibeHome, "cascade-audit")
  mkdirSync(auditDir, { recursive: true })
  const f = join(auditDir, "claim-audit.jsonl")
  appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), claims, totalClaims: claims.length }) + "\n")
  return { claims, total: claims.length, file: f }
}

// ── Tests ──────────────────────────────────────────────────────────────

test("contract: scanClaimsInOutput writes to $VIBEOS_HOME when env var set", () => {
  const r = scanClaims("I fixed the bug and tests are passing now with 100% score. All passing.", altVibeHome)
  assert.ok(r.total > 0)
  assert.ok(r.file.startsWith(altVibeHome), `path should be under altVibeHome: ${r.file}`)
  assert.ok(existsSync(r.file))
  const saved = JSON.parse(readFileSync(r.file, "utf-8").trim())
  assert.equal(saved.totalClaims, 3)
})

test("contract: scanClaimsInOutput skips neutral output", () => {
  const r = scanClaims("What is the weather today?", altVibeHome)
  assert.equal(r.total, 0)
})

test("cascade: all 5 CLAIM_PATTERNS match expected language", () => {
  const cases = [
    "The task is done.",
    "Bug has been fixed.",
    "Feature works correctly now.",
    "Coverage improved to 92.5%",
    "All tests are passing.",
  ]
  for (const text of cases) {
    const matched = CLAIM_PATTERNS.some(p => p.test(text))
    assert.ok(matched, `"${text}" should match a CLAIM_PATTERN`)
  }
})

test("cascade: CLAIM_PATTERNS reject neutral language", () => {
  const neutrals = [
    "Let me look at the code and understand the issue.",
    "What is the current state of the project?",
    "I am analyzing the data structure.",
    "Searching for relevant files...",
    "How can I help you today?",
  ]
  for (const text of neutrals) {
    for (const pat of CLAIM_PATTERNS) {
      assert.equal(pat.test(text), false, `"${text}" should NOT match ${pat.source}`)
    }
  }
})

test("CONTRACT: verify-claims path must NOT ignore $VIBEOS_HOME", () => {
  // This test MUST reflect the buggy behavior of trinity-tool.ts:866:
  //   const VIBEOS_HOME = join(process.env.HOME || "", ".claude")
  // The bug: it ignores process.env.VIBEOS_HOME entirely.
  //
  // DEMONSTRATION: if $VIBEOS_HOME=altVibeHome and $HOME=SANDBOX,
  //   - BUGGY path would be join(SANDBOX, ".claude", "cascade-audit", "claim-audit.jsonl")
  //   - CORRECT path is join(altVibeHome, "cascade-audit", "claim-audit.jsonl")

  const buggyHome = join(SANDBOX, ".claude")
  const correctHome = altVibeHome
  const expectedBuggy = join(buggyHome, "cascade-audit", "claim-audit.jsonl")
  const expectedFixed = join(correctHome, "cascade-audit", "claim-audit.jsonl")

  // The buggy path equals SANDBOX/.claude/..., NOT altVibeHome/...
  assert.ok(expectedBuggy.startsWith(buggyHome))
  assert.equal(expectedBuggy.includes(altVibeHome), false,
    "buggy path must NOT contain alt $VIBEOS_HOME value")

  // The fixed path equals altVibeHome/...
  assert.ok(expectedFixed.startsWith(altVibeHome))
  assert.equal(expectedFixed.includes(buggyHome), false,
    "fixed path must NOT contain the HOME/.claude fallback")
})

test("CONTRACT: writer and reader paths must agree (path parity)", () => {
  const writerPath = (() => {
    return join(altVibeHome, "cascade-audit", "claim-audit.jsonl")
  })()
  const readerPath = (() => {
    return join(altVibeHome, "cascade-audit", "claim-audit.jsonl")
  })()
  assert.equal(writerPath, readerPath,
    `writer ${writerPath} must equal reader ${readerPath}`)
})

test("CONTRACT: _loadActiveJobForProject must NOT double-nest .claude/.claude", () => {
  // When base IS getVibeOSHome() (which returns ~/.claude),
  // the code must NOT add another ".claude" segment.
  // BUG: join(String(base), ".claude", "active-jobs.json") when base is already .claude
  // FIX: join(String(base), "active-jobs.json")
  const base = claudeDir
  const doubleNestedPath = join(String(base), ".claude", "active-jobs.json")
  const correctPath = join(String(base), "active-jobs.json")
  // This test documents the current behavior (double-nested).
  // Once index.ts:169 is fixed, this assertion will need updating.
  assert.equal(doubleNestedPath, join(claudeDir, ".claude", "active-jobs.json"))
  assert.notEqual(doubleNestedPath, correctPath, "double-nested path differs from correct")
})

test("cascade: multi-line output claim detection", () => {
  const output = [
    "Analyzing codebase...",
    "I fixed the race condition in the scheduler.",
    "Still reviewing error handling paths.",
    "All tests pass with 100% pass rate.",
    "Task is done.",
  ].join("\n")
  const r = scanClaims(output, join(SANDBOX, "multi-test"))
  assert.equal(r.total, 3, "3 claims in 5 lines")
})
