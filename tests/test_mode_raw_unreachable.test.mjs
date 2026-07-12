// SPDX-License-Identifier: MIT
// Contract: CLAUDE.md item 4 documents `mode vibeultrax|vibeqmax|vibemax|vibelitex|raw`
// as a supported trinity command. mode-table.ts fully defines RAW_MODE ("Raw Brain",
// pure v4 Pro baseline, no vibeOS overhead) and exports it via ALL_MODES. But
// trinity-tool.ts's `slot` schema enum never listed "raw" (so the model could never
// even pass it as an argument), and separately the `action === "mode"` handler's
// internal allowlist/lookup (allModeIds, modeEntry) never included RAW_MODE either.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-mode-raw-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

function fakeSchema() {
  const captured = { enums: [] }
  const enumFn = (values) => { captured.enums.push(values); return { optional: () => ({}) } }
  return {
    captured,
    schema: {
      enum: enumFn,
      string: () => ({ optional: () => ({}) }),
      number: () => ({ optional: () => ({}) }),
    },
  }
}

test("trinity-tool's slot schema enum includes raw", async () => {
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const { schema, captured } = fakeSchema()
  createTrinityTool({ tool: { schema }, directory: sandbox })
  const slotEnum = captured.enums[1]
  assert.ok(Array.isArray(slotEnum), "expected the slot enum array to be captured")
  assert.ok(slotEnum.includes("raw"), `slot enum must include "raw": ${JSON.stringify(slotEnum)}`)
})

test("vibe mode raw is accepted and resolves a real mode entry, not rejected as invalid", async () => {
  const { schema } = fakeSchema()
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
    selection: {},
  }))
  const deps = {
    tool: { schema },
    directory: sandbox,
    _OC_SID: "test-session",
    saveOptimizationMode: () => true,
    writeSessionOptMode: () => {},
    writeSelection: () => {},
    writeSessionSlot: () => {},
    applySlot: () => ({ ok: true, ocModel: "test/brain" }),
    _refreshModel: () => {},
    _modelLocked: false,
    _lockedSlot: null,
    _lockedModel: null,
  }
  const trinityTool = createTrinityTool(deps)
  assert.ok(typeof trinityTool.execute === "function", "expected an execute function")
  const result = await trinityTool.execute({ action: "mode", slot: "raw" })
  assert.ok(
    !/Provide mode:/.test(result),
    `"raw" should be an accepted, resolvable mode, not rejected as invalid: ${result}`
  )
})

test("cleanup", () => {
  process.env.HOME = prevHome
  process.env.VIBEOS_HOME = prevVibeHome
  rmSync(sandbox, { recursive: true, force: true })
})
