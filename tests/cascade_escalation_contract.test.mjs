// SPDX-License-Identifier: MIT
// Locks the live cascade escalation contract (VibeUltraX). The handed-in finding
// claimed "escalation never fires because requires_delegation is only true for
// medium/brain". In reality resolveCascadeRouteDecision escalates per-call from
// the ML cascade: a complex prompt from the cheap pipeline root delegates to
// medium/brain; a simple prompt stays cheap. This test pins that so the cascade
// cannot silently regress to never-escalating.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-escalation-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

const te = await import("../src/lib/hooks/tool-execute.js?escalation=" + Date.now())

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

const TRINITY = {
  trinityCheap: "opencode/big-pickle",
  trinityMedium: "deepseek/deepseek-v4-flash",
  trinityBrain: "deepseek/deepseek-v4-pro",
  activePipeline: ["cheap", "medium", "brain"],
  mlEnabled: true,
}
const COMPLEX = "refactor the authentication module across src/auth.ts src/session.ts and src/db.ts to support OAuth and JWT refresh tokens with rate limiting while keeping backward compatibility and updating every related test file"
const SIMPLE = "what does this function do"

test("[escalation] a complex prompt from cheap root delegates to medium/brain", () => {
  const r = te.resolveCascadeRouteDecision({ prompt: COMPLEX, ...TRINITY })
  assert.ok(["medium", "brain"].includes(r.selectedSlot), `expected medium|brain, got ${r.selectedSlot}`)
  assert.equal(r.requiresDelegation, true, "complex prompt must require delegation")
})

test("[escalation] a simple prompt stays cheap with no delegation", () => {
  const r = te.resolveCascadeRouteDecision({ prompt: SIMPLE, ...TRINITY })
  assert.equal(r.selectedSlot, "cheap", `expected cheap, got ${r.selectedSlot}`)
  assert.equal(r.requiresDelegation, false, "simple prompt must not delegate")
})
