import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ROOT = join(import.meta.dirname, "..")

let tmpDir, origEnv, origHome

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "vibeos-title-"))
  origEnv = { ...process.env }
  origHome = process.env.HOME
  process.env.HOME = tmpDir
  process.env.VIBEOS_DEBUG = "1"
  process.env.NODE_ENV = "test"
  mkdirSync(join(tmpDir, ".claude"), { recursive: true })
  mkdirSync(join(tmpDir, ".config/opencode"), { recursive: true })
  mkdirSync(join(tmpDir, ".local/share/opencode"), { recursive: true })
  writeFileSync(join(tmpDir, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "medium", enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: "off",
      blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "test-brain" },
      medium: { oc: "test-medium" },
      cheap: { oc: "test-cheap" }
    }
  }, null, 2))
  writeFileSync(join(tmpDir, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { warn_count: 0, scratchpad_hits_observed: 0, missed_context7_usd: 0 },
    sessions: {}
  }, null, 2))
  writeFileSync(join(tmpDir, ".config/opencode/opencode.json"), JSON.stringify({
    model: "test-medium",
    provider: { test: { models: { "test-brain": {}, "test-medium": {}, "test-cheap": {} } } }
  }, null, 2))
}

function teardown() {
  process.env = { ...origEnv }
  if (origHome) process.env.HOME = origHome
  rmSync(tmpDir, { recursive: true, force: true })
}

async function loadPlugin() {
  const mod = await import(join(ROOT, "src", "index.js"))
  if (typeof mod.__test_reset_state === "function") mod.__test_reset_state()
  return mod
}

describe("PR #275 — tool titles preserved by footer hook", () => {
  it("output.title is NOT overwritten when footer is appended to output.output", async () => {
    setup()
    try {
      const mod = await loadPlugin()
      const hook = mod["tool.execute.after"]
      if (!hook) { console.log("SKIP: tool.execute.after hook not available"); return }
      const output = {
        title: "Task: Analyze code",
        output: "Original tool result text",
      }
      const input = { tool: "task", args: {} }
      await hook(input, output)
      assert.equal(output.title, "Task: Analyze code", "title must be preserved")
      assert.notEqual(output.output, "Original tool result text", "output.output must be modified with footer")
      assert.ok(output.output.includes("Original tool result text"), "original text must still be present")
    } finally {
      teardown()
    }
  })

  it("output.title is NOT overwritten when footer goes to output.result", async () => {
    setup()
    try {
      const mod = await loadPlugin()
      const hook = mod["tool.execute.after"]
      if (!hook) return
      const output = {
        title: "Task: Fix bug",
        result: "Bug fixed successfully",
      }
      const input = { tool: "task", args: {} }
      await hook(input, output)
      assert.equal(output.title, "Task: Fix bug", "title must be preserved")
      assert.ok(output.result.includes("Bug fixed successfully"), "original result text must still be present")
    } finally {
      teardown()
    }
  })

  it("footer is prepended to nested message object, not outer title", async () => {
    setup()
    try {
      const mod = await loadPlugin()
      const hook = mod["tool.execute.after"]
      if (!hook) return
      const output = {
        title: "Outer title",
        message: { output: "Nested output text" },
      }
      const input = { tool: "task", args: {} }
      await hook(input, output)
      assert.equal(output.title, "Outer title", "outer title must be preserved")
      assert.ok(output.message.output.includes("Nested output text"), "original nested text must still be present")
    } finally {
      teardown()
    }
  })

  it("footer falls back to output property when no string content fields exist", async () => {
    setup()
    try {
      const mod = await loadPlugin()
      const hook = mod["tool.execute.after"]
      if (!hook) return
      const output = {
        title: "No text fields",
        content: { nested: true },
      }
      const input = { tool: "task", args: {} }
      await hook(input, output)
      assert.equal(output.title, "No text fields", "title must be preserved")
      assert.equal(typeof output.output, "string", "output.output should be set as fallback")
      assert.ok(output.output.length > 0, "fallback output must not be empty")
    } finally {
      teardown()
    }
  })
})
