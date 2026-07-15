// SPDX-License-Identifier: MIT
// Contract: vibeultraxPipeline (default mode) must CAPTURE workflow snapshots on
// pivot, not just read them. Before this fix, vibeultraxPipeline only ever called
// PivotCache.detectPivotBack()/.read()/.buildInjection() -- it never called
// .snapshot(). Only vibemaxPipeline's pipeline wrote snapshots. Since the live app
// defaults to vibeultrax, pivot-back detection could never match anything real:
// confirmed live via $VIBEOS_HOME/.vibeos-pivot-cache.json having only stale
// vibemax-era entries and zero fresh vibeultrax entries.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-vibeultrax-pivot-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")

test("vibeultraxPipeline captures a workflow snapshot when the user pivots away, and matches it on pivot-back", async () => {
  const state = await import("../src/lib/state.js")
  // Unique per run -- a hardcoded id collided with other test files' pivot
  // cache entries when run in the same shared-process CI suite, causing an
  // intermittent order-dependent failure unrelated to the pipeline logic.
  state.setCurrentSessionId("session-vibeultrax-pivot-test-" + Date.now())
  const { vibeultraxPipeline } = await import("../src/vibeOS-lib/blackbox/vibeultrax.js")

  // detectPivotBack requires at least 2 captured snapshots in the sequence and
  // always excludes the most-recent one from candidate matching -- so this needs
  // two forward pivots before a pivot-back can match the FIRST captured workflow.

  // Turn 1: working on debugging/fixing something.
  const r1 = vibeultraxPipeline({
    user_text: "help me debug this broken error in the parser",
    _pivotContext: { decisions: ["chose regex-based parser fix"], files: ["src/parser.ts"] },
  })
  assert.ok(r1, "pipeline should return a result")

  // Turn 2: pivot to an unrelated topic (deploy/release) -- snapshots turn 1's
  // debugging workflow.
  const r2 = vibeultraxPipeline({
    user_text: "now let's deploy and release the new version",
    _pivotContext: { decisions: ["bump version to 1.2.3"], files: ["package.json"] },
  })
  assert.ok(r2, "pipeline should return a result")

  // Turn 3: pivot again to a third unrelated topic -- snapshots turn 2's deploy
  // workflow, giving the cache 2 entries so pivot-back matching can activate.
  const r3 = vibeultraxPipeline({
    user_text: "let's write documentation for the config settings",
    _pivotContext: { decisions: ["drafted config docs outline"], files: ["docs/config.md"] },
  })
  assert.ok(r3, "pipeline should return a result")

  // Turn 4: pivot BACK to the original debugging topic -- should match the
  // captured workflow from turn 1 and inject its context.
  const r4 = vibeultraxPipeline({ user_text: "back to debugging that broken parser error" })
  assert.equal(r4.pivot_detected, true, "should detect a pivot-back match to the captured debugging workflow")
  assert.ok(r4.pivot?.injection, "should build an injection from the captured workflow")
  assert.ok(
    /parser|debug/i.test(r4.pivot.injection),
    `injection should reference the originally captured debugging workflow: ${r4.pivot?.injection}`
  )
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
