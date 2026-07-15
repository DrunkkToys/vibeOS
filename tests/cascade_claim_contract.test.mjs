// SPDX-License-Identifier: MIT
// Contract + cascade tests for structural claim grammar.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const SANDBOX = join(tmpdir(), "vibeos-claim-structural-test-" + Date.now())
const AUDIT_DIR = join(SANDBOX, "cascade-audit")
const CLAIM_FILE = join(AUDIT_DIR, "claim-audit.jsonl")
const CASCADE_FILE = join(AUDIT_DIR, "cascade-audit.jsonl")

function setup(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

const VIBEOS_HOME = SANDBOX
const CLAIM_PATTERNS = [
  /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
  /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
  /v\d+\.\d+\.\d+/,
  /\d+\s*(?:test|spec)s?\s*(?:pass|passing)/i,
  /(?:done|finished|complete)/i,
  /(?:fixed|resolved|solved)/i,
  /(?:works|working|validated|verified)/i,
  /(?:exit\s*code\s*0|0\s*errors|0\s*failures)/i,
  /(?:\d+%|score|scored|passing|passed)/i,
  /\b(?:healthy|no\s+(?:degradation|issues|problems)|all\s+good|everything\s+(?:is\s+)?(?:fine|ok|okay))\b/i,
]

test("contract: ACTION pattern matches 'I pushed the release'", () => {
  assert.ok(CLAIM_PATTERNS[0].test("I pushed the release and it deployed cleanly"))
})

test("contract: ACTION pattern matches 'we merged the PR'", () => {
  assert.ok(CLAIM_PATTERNS[0].test("we merged the PR"))
})

test("contract: STATE pattern matches 'tests are passing'", () => {
  assert.ok(CLAIM_PATTERNS[1].test("tests are passing now"))
})

test("contract: STATE pattern matches 'CI is green'", () => {
  assert.ok(CLAIM_PATTERNS[1].test("the build is green in CI"))
})

test("contract: VERSION pattern matches version strings", () => {
  assert.ok(CLAIM_PATTERNS[2].test("v0.25.39"))
  assert.ok(CLAIM_PATTERNS[2].test("v1.0.0"))
})

test("contract: NUMERIC pattern matches test counts", () => {
  assert.ok(CLAIM_PATTERNS[3].test("10 tests pass"))
  assert.ok(CLAIM_PATTERNS[3].test("3 specs passing"))
})

test("contract: EXIT pattern matches exit codes", () => {
  assert.ok(CLAIM_PATTERNS[7].test("exit code 0"))
  assert.ok(CLAIM_PATTERNS[7].test("0 errors"))
  assert.ok(CLAIM_PATTERNS[7].test("0 failures"))
})

test("contract: DONE/FIX/WORKS patterns match claim language", () => {
  assert.ok(CLAIM_PATTERNS[4].test("the implementation is done"))
  assert.ok(CLAIM_PATTERNS[5].test("the bug is fixed"))
  assert.ok(CLAIM_PATTERNS[6].test("the feature works now"))
})

// Live-reproduced gap (2026-07-15): a real "vibe diagnose cascade" turn responded
// "Cascade Diagnosis: Healthy... No lock, no stress, no degradation." while the actual
// state on disk showed model-tiers.json's cheap_first_degraded=true with a real reason
// recorded. None of the prior CLAIM_PATTERNS matched this text at all, so it never got
// written to claim-audit.jsonl and `vibe verify-claims` had nothing to check.
test("contract: STATUS pattern catches confident health/status claims prior patterns missed", () => {
  assert.ok(CLAIM_PATTERNS[9].test("Cascade Diagnosis: Healthy."))
  assert.ok(CLAIM_PATTERNS[9].test("No lock, no stress, no degradation."))
  assert.ok(CLAIM_PATTERNS[9].test("Everything is fine now."))
  assert.ok(CLAIM_PATTERNS[9].test("All good, nothing to report."))
})

test("contract: neutral language does NOT match any pattern", () => {
  const neutral = [
    "what do you think about this?",
    "could you elaborate on the approach?",
    "here is a summary of the issue:",
    "the function signature is:",
    "let me check the documentation",
  ]
  for (const n of neutral) {
    for (let i = 0; i < CLAIM_PATTERNS.length; i++) {
      assert.equal(CLAIM_PATTERNS[i].test(n), false, "neutral text must not match pattern " + i + ": " + n)
    }
  }
})

test("contract: auto-verify path reads claim-audit and cascade-audit", () => {
  setup(AUDIT_DIR)
  const claimTs = new Date().toISOString()
  appendFileSync(CLAIM_FILE, JSON.stringify({
    ts: claimTs, claims: [{ text: "I pushed the release", pattern: "action" }], totalClaims: 1
  }) + "\n")
  // cascade-audit has a run within 2 min -> substantiated
  const cascadeTs = new Date(Date.now() - 60000).toISOString()
  appendFileSync(CASCADE_FILE, JSON.stringify({ _ts: cascadeTs, answer_empty: false }) + "\n")
  let unsub = 0
  const claimLines = readFileSync(CLAIM_FILE, "utf-8").trim().split("\n").slice(-10)
  const cascadeLines = readFileSync(CASCADE_FILE, "utf-8").trim().split("\n").slice(-30)
  const cascadeRuns = cascadeLines.filter(Boolean).map(function(l) { try { return JSON.parse(l) } catch {} }).filter(Boolean)
  for (const cl of claimLines) {
    if (!cl.trim()) continue
    let entry
    try { entry = JSON.parse(cl) } catch { continue }
    if (!entry) continue
    const claimTexts = (entry.claims || []).map(function(c) { return c.text }).join(" | ")
    if (!CLAIM_PATTERNS.some(function(p) { return p.test(claimTexts) })) continue
    let cascadeMatch = false
    for (const cr of cascadeRuns) {
      const cTs = cr._ts || ""
      if (cTs && entry.ts && Math.abs(new Date(cTs).getTime() - new Date(entry.ts).getTime()) < 120000) {
        cascadeMatch = true
        break
      }
    }
    if (!cascadeMatch) unsub++
  }
  assert.equal(unsub, 0, "with nearby cascade run, claim must be substantiated")
})

test("contract: auto-amend injects verification message for unsubstantiated claims", () => {
  const sandbox = join(tmpdir(), "vibeos-amend-test-" + Date.now())
  const auditDir = join(sandbox, "cascade-audit")
  const claimFile = join(auditDir, "claim-audit.jsonl")
  const cascadeFile = join(auditDir, "cascade-audit.jsonl")
  mkdirSync(auditDir, { recursive: true })
  const prevHome = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = sandbox

  // Write an unsubstantiated claim (no matching cascade run)
  appendFileSync(claimFile, JSON.stringify({
    ts: new Date().toISOString(),
    claims: [{ text: "I pushed the release", pattern: "action" }],
    totalClaims: 1,
  }) + "\n")

  // Write a cascade run outside 2min window (3min old -> unsubstantiated)
  const oldTs = new Date(Date.now() - 180000).toISOString()
  appendFileSync(cascadeFile, JSON.stringify({ _ts: oldTs, answer_empty: false }) + "\n")

  // Simulate onMessagesTransform logic
  const messages = [
    { role: "user", parts: [{ type: "text", text: "did it work?" }] },
    { role: "assistant", parts: [{ type: "text", text: "I pushed the release" }] },
  ]
  let unsubClaims = []
  let lastInjectTs = 0
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - 4); i--) {
    const m = messages[i]
    if (m?.role === "assistant" && Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (p?.type === "text" && typeof p.text === "string" && p.text.includes("[verify]")) {
          lastInjectTs = Date.now()
        }
      }
    }
  }
  const claimLines = readFileSync(claimFile, "utf-8").trim().split("\n").slice(-5)
  const cascadeLines = readFileSync(cascadeFile, "utf-8").trim().split("\n").slice(-20)
  const cascadeRuns = cascadeLines.filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  for (const cl of claimLines) {
    if (!cl.trim()) continue
    let entry
    try { entry = JSON.parse(cl) } catch { continue }
    if (!entry) continue
    const claimTexts = (entry.claims || []).map(c => c.text).join(" | ")
    if (!/(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed)\b|(?:tests?|build|CI|checks?)\s+(?:is\s+|are\s+)?(?:pass|green|clean)\b|v\d+\.\d+\.\d+|done|fixed|works|exit\s*code\s*0|\d+%|score|passed/i.test(claimTexts)) continue
    let cascadeMatch = false
    for (const cr of cascadeRuns) {
      const cTs = cr._ts || ""
      if (cTs && entry.ts && Math.abs(new Date(cTs).getTime() - new Date(entry.ts).getTime()) < 120000) {
        cascadeMatch = true
        break
      }
    }
    if (!cascadeMatch) {
      for (const c of (entry.claims || [])) {
        unsubClaims.push(c.text)
      }
    }
  }
  assert.equal(unsubClaims.length, 1, "must detect 1 unsubstantiated claim")
  assert.ok(unsubClaims[0].includes("pushed the release"), "must contain the claim text")

  // Inject verification message
  const verifyText = "\n[vibeOS verify]\nUnsubstantiated claims from previous turn:\n" +
    unsubClaims.slice(0, 5).map(t => "  - \"" + t.substring(0, 80) + "\"").join("\n") +
    "\nPlease verify each claim and correct if inaccurate."
  messages.push({ role: "assistant", parts: [{ type: "text", text: verifyText, synthetic: true }] })
  assert.equal(messages.length, 3, "verification message must be appended")
  assert.ok(messages[2].parts[0].text.includes("[vibeOS verify]"), "injected message must contain [vibeOS verify] marker")

  process.env.VIBEOS_HOME = prevHome
  rmSync(sandbox, { recursive: true, force: true })
})