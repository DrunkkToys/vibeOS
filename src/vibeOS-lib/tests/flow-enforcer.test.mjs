import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync, mkdirSync, readFileSync } from "fs"
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
writeFileSync(join(process.env.HOME, ".claude/.flow-todo-queue.jsonl"), "", { flag: "w" })

describe("flow-enforcer smoke — getFlowWarns", () => {
  it("is exported as a function", () => {
    assert.strictEqual(typeof getFlowWarns, "function")
    assert.strictEqual(getFlowWarns.name, "getFlowWarns")
    assert.doesNotThrow(() => getFlowWarns())
  })

  it("returns an array", () => {
    const warns = getFlowWarns()
    assert.ok(Array.isArray(warns))
    assert.strictEqual(warns.length, 0)
    assert.deepStrictEqual(warns, [])
  })

  it("returns an array after reset", () => {
    resetForTest([])
    const warns = getFlowWarns()
    assert.ok(Array.isArray(warns))
    assert.strictEqual(warns.length, 0)
    assert.deepStrictEqual(warns, [])
  })
})

describe("flow-enforcer smoke — recordFlowTodo", () => {
  it("is exported as a function", () => {
    assert.strictEqual(typeof recordFlowTodo, "function")
    assert.strictEqual(recordFlowTodo.name, "recordFlowTodo")
  })

  it("extracts TODO/FIXME from content and returns count", () => {
    resetForTest([])
    // Clear the flow todo queue for this test
    try {
      const testFile = join(process.env.HOME || homedir(), ".claude/.flow-todo-queue.jsonl")
      writeFileSync(testFile, "")
    } catch {}
    const content = "// TODO: fix this\nconst x = 1\n// FIXME: also this"
    const n = recordFlowTodo({ filePath: "src/test.js", content })
    assert.ok(typeof n === "number")
    assert.ok(n >= 2, `expected >=2 TODOs, got ${n}`)
    assert.strictEqual(n, 2)
  })

  it("returns 0 when no TODOs in content", () => {
    const content = "const x = 1\nconst y = 2"
    const n = recordFlowTodo({ filePath: "src/test.js", content })
    assert.strictEqual(n, 0)
    assert.strictEqual(typeof n, "number")
  })

  it("returns 0 for empty content", () => {
    const n = recordFlowTodo({ filePath: "src/test.js", content: "" })
    assert.strictEqual(n, 0)
    assert.strictEqual(typeof n, "number")
  })
})

describe("flow-enforcer smoke — exports match vitest skeleton", () => {
  it("resolveRulesPath and checkFlowRules are functions", () => {
    assert.strictEqual(typeof resolveRulesPath, "function")
    assert.strictEqual(typeof checkFlowRules, "function")
    assert.strictEqual(resolveRulesPath.name, "resolveRulesPath")
    assert.strictEqual(checkFlowRules.name, "checkFlowRules")
  })

  it("getSessionFlowCounts and resetForTest are functions", () => {
    assert.strictEqual(typeof getSessionFlowCounts, "function")
    assert.strictEqual(typeof resetForTest, "function")
    assert.strictEqual(getSessionFlowCounts.name, "getSessionFlowCounts")
    assert.strictEqual(resetForTest.name, "resetForTest")
  })

  it("resetAll and addFlowRule are functions", () => {
    assert.strictEqual(typeof resetAll, "function")
    assert.strictEqual(typeof addFlowRule, "function")
    assert.strictEqual(resetAll.name, "resetAll")
    assert.strictEqual(addFlowRule.name, "addFlowRule")
  })
})
