// SPDX-License-Identifier: MIT
// The live ML cascade (resolveCascadeRouteDecision -> cascadeDecide) made routing
// decisions but wrote NO audit trail: cascade-audit/cascade-audit.jsonl never
// existed in VIBEOS_HOME, yet claim-verification.ts (loadRecentCascadeRuns) reads
// it to substantiate "tests pass / I fixed it" claims. This pins the writer:
// every cascade decision appends a JSONL line with a parseable _ts that the
// verifier can correlate.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cascade-audit-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

const te = await import("../src/lib/hooks/tool-execute.js?cascadeaudit=" + Date.now())
const cv = await import("../src/lib/claim-verification.js?cascadeaudit=" + Date.now())
const auditFile = join(sandbox, ".claude", "cascade-audit", "cascade-audit.jsonl")

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

const COMPLEX = "refactor the authentication module across src/auth.ts src/session.ts and src/db.ts to support OAuth and JWT refresh tokens with rate limiting while keeping backward compatibility and updating every related test file"

test("[cascade-audit] a cascade decision appends a parseable _ts line", () => {
  te.resolveCascadeRouteDecision({
    prompt: COMPLEX,
    trinityCheap: "opencode/big-pickle",
    trinityMedium: "deepseek/deepseek-v4-flash",
    trinityBrain: "deepseek/deepseek-v4-pro",
    activePipeline: ["cheap", "medium", "brain"],
    mlEnabled: true,
  })
  assert.ok(existsSync(auditFile), "cascade-audit.jsonl must be written")
  const lines = readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean)
  assert.ok(lines.length >= 1, "at least one audit line")
  const entry = JSON.parse(lines[lines.length - 1])
  assert.ok(entry._ts && Number.isFinite(new Date(entry._ts).getTime()), "_ts must be date-parseable")
  assert.equal(typeof entry.slot, "string")
  assert.ok("escalate" in entry, "entry records the escalate decision")
  assert.ok("confidence" in entry, "entry records confidence")
})

test("[cascade-audit] the written line substantiates a claim within the window", () => {
  const res = cv.evaluateClaimVerification({
    text: "I fixed it and all tests are passing",
    vibeHome: join(sandbox, ".claude"),
    now: Date.now(),
    windowMs: 120000,
  })
  assert.equal(res.unsubstantiatedCount, 0, "recent cascade run should substantiate the claim")
  assert.equal(res.claimTag, "✓")
})
