// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Regression tests for "Assignment to constant variable" crashes (commit e5c10d1)
//
// These guard against the following classes of bugs:
//   A) Missing setCurrentModel/setCurrentTier imports in pricing.js
//      → _refreshModel() would call undefined functions → ReferenceError → silently
//        swallowed by try/catch, leaving currentModel/currentTier always null.
//   B) setLastMutationEvent exported from state.js but never defined as a function
//      → module load fails with "Export 'setLastMutationEvent' is not defined"
//   C) index-helpers.ts assigning directly to imported lastMutationEvent
//      → ES module read-only binding violation → "Assignment to constant variable"
//   D) tool-execute.ts importing applyDecadence from index-helpers.js
//      → index-helpers no longer re-exports it (moved to state.js) → module load fail

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const ROOT = new URL("..", import.meta.url).pathname

// ── A) Module chain integrity: src/index.js must load without export errors ──
test("module chain: src/index.js loads without export errors", async () => {
  const mod = await import(join(ROOT, "src/index.js"))
  assert.ok(typeof mod.DelegationEnforcer === "function", "DelegationEnforcer exported")
  assert.ok(mod.id === "vibeOS", "id is vibeOS")
})

// ── B) setLastMutationEvent is defined and callable ──
test("setLastMutationEvent: function is defined and exported from state.js", async () => {
  const stateMod = await import(join(ROOT, "src/lib/state.js"))
  assert.equal(typeof stateMod.setLastMutationEvent, "function", "setLastMutationEvent is a function")
  stateMod.setLastMutationEvent({ at: Date.now(), path: "test.js", tool: "write" })
  assert.ok(stateMod.lastMutationEvent !== null, "lastMutationEvent was set")
  assert.equal(stateMod.lastMutationEvent.path, "test.js", "lastMutationEvent.path matches")
  assert.equal(stateMod.lastMutationEvent.tool, "write", "lastMutationEvent.tool matches")
  stateMod.setLastMutationEvent(null)
  assert.equal(stateMod.lastMutationEvent, null, "lastMutationEvent cleared")
})

// ── C) index-helpers does NOT directly assign to imported lastMutationEvent ──
test("index-helpers: source does not contain direct assignment to imported lastMutationEvent", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(join(ROOT, "src/lib/index-helpers.js"), "utf-8")
  // The source must use setLastMutationEvent(...), never `lastMutationEvent =`
  const directAssignment = /[^s]lastMutationEvent\s*=\s*\{/.test(src)
  if (directAssignment) {
    // List the offending lines for debugging
    const lines = src.split("\n")
    const offenders = lines.filter(l => /[^s]lastMutationEvent\s*=\s*\{/.test(l))
    console.error("Direct assignment lines:", offenders.join("\n"))
  }
  assert.equal(directAssignment, false, "index-helpers.js must not directly assign to lastMutationEvent")
})

// ── D) setCurrentModel/setCurrentTier are importable by pricing.js ──
test("pricing.js: setCurrentModel and setCurrentTier resolve correctly", async () => {
  const stateMod = await import(join(ROOT, "src/lib/state.js"))
  assert.equal(typeof stateMod.setCurrentModel, "function", "setCurrentModel is importable")
  assert.equal(typeof stateMod.setCurrentTier, "function", "setCurrentTier is importable")

  const savedModel = stateMod.currentModel
  const savedTier = stateMod.currentTier

  stateMod.setCurrentModel("test-model")
  stateMod.setCurrentTier("high")

  assert.equal(stateMod.currentModel, "test-model", "currentModel updated via setter")
  assert.equal(stateMod.currentTier, "high", "currentTier updated via setter")

  stateMod.setCurrentModel(savedModel)
  stateMod.setCurrentTier(savedTier)
})

// ── E) applyDecadence is importable from state.js (not from index-helpers.js) ──
test("applyDecadence: importable from state.js", async () => {
  const { applyDecadence } = await import(join(ROOT, "src/lib/state.js"))
  assert.equal(typeof applyDecadence, "function", "applyDecadence is importable from state.js")
})

// ── F) _refreshModel is importable and callable without crashing ──
test("_refreshModel: does not crash when called (imports resolve)", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-reg-"))
  const oldHome = process.env.HOME
  process.env.HOME = sandbox
  try {
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    mkdirSync(join(sandbox, ".config/opencode"), { recursive: true })

    // Write a minimal model-tiers.json with brain slot
    writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
      selection: { active_slot: "brain", enabled: true },
      trinity: {
        brain:  { oc: "deepseek/deepseek-v4-pro" },
        medium: { oc: "deepseek/deepseek-v4-flash" },
        cheap:  { oc: "deepseek/deepseek-chat" }
      }
    }, null, 2))

    // Write a minimal opencode.json
    writeFileSync(join(sandbox, ".config/opencode/opencode.json"), JSON.stringify({
      model: "deepseek/deepseek-v4-pro"
    }, null, 2))

    const { _refreshModel } = await import(join(ROOT, "src/index.js"))
    assert.doesNotThrow(() => _refreshModel(sandbox), "_refreshModel should not throw")
  } finally {
    process.env.HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ── G) onShellEnv hook is importable ──
test("shell-env: onShellEnv is importable and callable", async () => {
  const { onShellEnv } = await import(join(ROOT, "src/lib/hooks/shell-env.js"))
  assert.equal(typeof onShellEnv, "function", "onShellEnv is importable")

  const output = { env: {} }
  await assert.doesNotReject(
    async () => { await onShellEnv({}, output) },
    "onShellEnv should not reject"
  )
  assert.ok(output.env.OPENCODE_MODEL_TIER !== undefined, "OPENCODE_MODEL_TIER set")
  assert.ok(output.env.OPENCODE_MODEL !== undefined, "OPENCODE_MODEL set")
})

// ── H) pricing.js does not have orphaned local currentTier/currentModel declarations ──
test("pricing.js: no orphaned local currentTier/currentModel (imports from state.js)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(join(ROOT, "src/lib/pricing.js"), "utf-8")
  // After the fix, pricing.js imports these from state.js and does NOT declare them locally
  assert.ok(src.includes("import { currentModel, currentTier, setCurrentModel, setCurrentTier }"), 
    "pricing.js imports currentModel/currentTier/setCurrentModel/setCurrentTier from state.js")
  // Must NOT have local let declarations for these anymore
  assert.ok(!src.includes("\nlet currentTier = null"), "pricing.js must not have orphaned local let currentTier")
  assert.ok(!src.includes("\nlet currentModel = null"), "pricing.js must not have orphaned local let currentModel")
})

// ── I) No module-level "Assignment to constant variable" regression: verify no
//        direct assignment patterns remain in any hook file ──
test("regression: no direct assignment to imported state vars in hooks", async () => {
  const { readFileSync } = await import("node:fs")
  const hooksDir = join(ROOT, "src/lib/hooks")
  const hookFiles = [
    "tool-execute.js", "footer.js", "chat-transform.js", "shell-env.js", "session-compact.js"
  ]

  for (const file of hookFiles) {
    const path = join(hooksDir, file)
    const src = readFileSync(path, "utf-8")

    // Extract names imported from state.js
    const stateImportMatch = src.match(/import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/state\.js['"]/)
    if (!stateImportMatch) continue

    const importedNames = stateImportMatch[1]
      .split(",")
      .map(n => n.trim())
      .filter(n => n.length > 0 && !n.startsWith("//"))

    // Check if there's a local `let` or `const` declaration that shadows the import
    // (local declarations are safe to assign to)
    const localDeclarations = new Set()
    for (const line of src.split("\n")) {
      const trimmed = line.trim()
      for (const name of importedNames) {
        if (new RegExp(`^(let|const|var)\\s+${name}\\s*=`).test(trimmed)) {
          localDeclarations.add(name)
        }
      }
    }

    // Now check each line for direct assignment to imported names
    // (that are NOT locally shadowed)
    const lines = src.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("import ")) continue

      for (const name of importedNames) {
        if (localDeclarations.has(name)) continue
        // Match: name = something (not === or !==)
        const assignRe = new RegExp(`^\\s*${name}\\s*=\\s*[^=]`)
        if (assignRe.test(trimmed)) {
          // Skip if it's inside a setter function (e.g. export function setName(v) { name = v; })
          // We detect this by checking if the line is inside a function body that defines a setter
          assert.fail(`${file}:${i + 1}: direct assignment to imported '${name}' — must use setter`)
        }
      }
    }
  }
  assert.ok(true, "no direct assignments found")
})
