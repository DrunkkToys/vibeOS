import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"

import {
  resolveRulesPath,
  checkFlowRules,
  getFlowWarns,
  getSessionFlowCounts,
  resetForTest,
  resetAll,
  addFlowRule,
  recordFlowTodo,
} from "../flow-enforcer.js"

const _origHome = process.env.HOME
process.env.HOME = join(tmpdir(), `flow-enforcer-test-${Date.now()}`)
mkdirSync(join(process.env.HOME, ".claude"), { recursive: true })
writeFileSync(join(process.env.HOME, ".claude/flow-todo-queue.jsonl"), "", { flag: "w" })

describe("flow-enforcer smoke — getFlowWarns", () => {
  it("is exported as a function", () => {
    assert.strictEqual(typeof getFlowWarns, "function")
  })

  it("returns an array", () => {
    const warns = getFlowWarns()
    assert.ok(Array.isArray(warns))
  })

  it("returns an array after reset", () => {
    resetForTest([])
    const warns = getFlowWarns()
    assert.ok(Array.isArray(warns))
  })
})

describe("flow-enforcer smoke — recordFlowTodo", () => {
  it("is exported as a function", () => {
    assert.strictEqual(typeof recordFlowTodo, "function")
  })

  it("extracts TODO/FIXME from content and returns count", () => {
    resetForTest([])
    // Clear the flow todo queue for this test
    try {
      const testFile = join(process.env.HOME || homedir(), ".claude/flow-todo-queue.jsonl")
      writeFileSync(testFile, "")
    } catch {}
    const content = "// TODO: fix this\nconst x = 1\n// FIXME: also this"
    const n = recordFlowTodo({ filePath: "src/test.js", content })
    assert.ok(typeof n === "number")
    assert.ok(n >= 2, `expected >=2 TODOs, got ${n}`)
  })

  it("returns 0 when no TODOs in content", () => {
    const content = "const x = 1\nconst y = 2"
    const n = recordFlowTodo({ filePath: "src/test.js", content })
    assert.strictEqual(n, 0)
  })

  it("returns 0 for empty content", () => {
    const n = recordFlowTodo({ filePath: "src/test.js", content: "" })
    assert.strictEqual(n, 0)
  })
})

describe("flow-enforcer smoke — exports match vitest skeleton", () => {
  it("resolveRulesPath is a function", () => {
    assert.strictEqual(typeof resolveRulesPath, "function")
  })

  it("checkFlowRules is a function", () => {
    assert.strictEqual(typeof checkFlowRules, "function")
  })

  it("getSessionFlowCounts is a function", () => {
    assert.strictEqual(typeof getSessionFlowCounts, "function")
  })

  it("resetForTest is a function", () => {
    assert.strictEqual(typeof resetForTest, "function")
  })

  it("resetAll is a function", () => {
    assert.strictEqual(typeof resetAll, "function")
  })

  it("addFlowRule is a function", () => {
    assert.strictEqual(typeof addFlowRule, "function")
  })
})
