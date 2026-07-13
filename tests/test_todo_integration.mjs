//
// test_todo_integration.mjs
// Covers todo integration:
//   1. Todo persistence (add, read, dedup, mark done)
//   2. Flow TODO sync
//   3. Interception from todowrite
//
import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"

// ── Helpers: temp home dir isolation ─────────────────────────────────
let _tmpDir, _origHome

function isolateHome() {
  _origHome = process.env.HOME
  _tmpDir = mkdtempSync(join(import.meta.dirname, "../tmp-todo-test-"))
  process.env.HOME = _tmpDir
}

function restoreHome() {
  process.env.HOME = _origHome
  if (_tmpDir) { try { rmSync(_tmpDir, { recursive: true, force: true }) } catch {} }
}

// ── Import state module ───────────────────────────────────────────────
let loadTodos, saveTodos, upsertTodo, markTodoDone, TODOS_FILE, loadTodosForCurrentProject, setCurrentProjectFingerprint

before(async () => {
  isolateHome()
  const state = await import("../src/lib/state.js")
  loadTodos = state.loadTodos
  saveTodos = state.saveTodos
  upsertTodo = state.upsertTodo
  markTodoDone = state.markTodoDone
  TODOS_FILE = state.TODOS_FILE
  loadTodosForCurrentProject = state.loadTodosForCurrentProject
  setCurrentProjectFingerprint = state.setCurrentProjectFingerprint
})

after(() => {
  restoreHome()
})

describe("todo persistence", () => {
  it("loadTodos returns empty array for missing file", () => {
    const todos = loadTodos()
    assert.ok(Array.isArray(todos))
    assert.strictEqual(todos.length, 0)
  })

  it("upsertTodo adds new entry", () => {
    saveTodos([])
    upsertTodo({ content: "test todo", priority: "high", source: "test" })
    const todos = loadTodos()
    assert.strictEqual(todos.length, 1)
    assert.strictEqual(todos[0].content, "test todo")
    assert.strictEqual(todos[0].priority, "high")
    assert.strictEqual(todos[0].source, "test")
    assert.strictEqual(todos[0].status, "pending")
    assert.ok(todos[0].id)
    assert.ok(todos[0].createdAt)
    assert.ok(todos[0].updatedAt)
  })

  it("upsertTodo deduplicates by content", () => {
    saveTodos([])
    upsertTodo({ content: "dedupe" })
    upsertTodo({ content: "dedupe" })
    const todos = loadTodos()
    assert.strictEqual(todos.length, 1)
  })

  it("upsertTodo deduplicates by content + filePath", () => {
    saveTodos([])
    upsertTodo({ content: "same", filePath: "a.ts" })
    upsertTodo({ content: "same", filePath: "b.ts" })
    const todos = loadTodos()
    assert.strictEqual(todos.length, 2)
  })

  it("markTodoDone sets status to done", () => {
    saveTodos([])
    upsertTodo({ content: "done test" })
    const id = loadTodos()[0].id
    markTodoDone(id)
    const updated = loadTodos()
    assert.strictEqual(updated[0].status, "done")
  })

  it("markTodoDone with nonexistent id does not crash", () => {
    saveTodos([])
    upsertTodo({ content: "still here" })
    markTodoDone("nonexistent-id")
    assert.strictEqual(loadTodos().length, 1)
  })

  it("file is persisted to disk", () => {
    saveTodos([])
    upsertTodo({ content: "persisted" })
    assert.ok(existsSync(TODOS_FILE))
    const raw = JSON.parse(readFileSync(TODOS_FILE, "utf-8"))
    assert.strictEqual(raw.length, 1)
    assert.strictEqual(raw[0].content, "persisted")
  })

  it("loadTodos handles malformed JSON gracefully", () => {
    writeFileSync(TODOS_FILE, "not json", "utf-8")
    const todos = loadTodos()
    assert.ok(Array.isArray(todos))
    assert.strictEqual(todos.length, 0)
  })

  it("loadTodos handles array with null entries gracefully", () => {
    writeFileSync(TODOS_FILE, "null", "utf-8")
    const todos = loadTodos()
    assert.ok(Array.isArray(todos))
    assert.strictEqual(todos.length, 0)
  })

  it("status defaults to pending", () => {
    saveTodos([])
    upsertTodo({ content: "default status" })
    assert.strictEqual(loadTodos()[0].status, "pending")
  })

  it("priority defaults to medium", () => {
    saveTodos([])
    upsertTodo({ content: "default priority" })
    assert.strictEqual(loadTodos()[0].priority, "medium")
  })

  it("source defaults to manual", () => {
    saveTodos([])
    upsertTodo({ content: "default source" })
    assert.strictEqual(loadTodos()[0].source, "manual")
  })

  // Regression: todos.json is a single global file with no project scoping.
  // Confirmed live: a real user's todos.json had 1609 pending entries, most
  // from unrelated repos (VibeBrainUltra), none from the current project --
  // `vibe todo` reported "1,609 pending" instead of anything meaningful.
  it("upsertTodo stamps the current project's fingerprint", () => {
    saveTodos([])
    setCurrentProjectFingerprint("proj-a")
    upsertTodo({ content: "todo in project a" })
    assert.strictEqual(loadTodos()[0].projectFingerprint, "proj-a")
    setCurrentProjectFingerprint("")
  })

  it("loadTodosForCurrentProject only returns todos matching the current project", () => {
    saveTodos([])
    setCurrentProjectFingerprint("proj-a")
    upsertTodo({ content: "todo in project a" })
    setCurrentProjectFingerprint("proj-b")
    upsertTodo({ content: "todo in project b" })
    setCurrentProjectFingerprint("proj-a")
    const scoped = loadTodosForCurrentProject()
    assert.strictEqual(scoped.length, 1)
    assert.strictEqual(scoped[0].content, "todo in project a")
    setCurrentProjectFingerprint("")
  })

  it("loadTodosForCurrentProject excludes legacy entries with no projectFingerprint", () => {
    saveTodos([{ id: "legacy-1", content: "legacy todo from before project scoping existed", status: "pending", filePath: "", priority: "medium", source: "manual", createdAt: "", updatedAt: "" }])
    setCurrentProjectFingerprint("proj-a")
    const scoped = loadTodosForCurrentProject()
    assert.strictEqual(scoped.length, 0, "legacy unscoped entries from unrelated projects must not leak into the current project's view")
    setCurrentProjectFingerprint("")
  })

  it("loadTodosForCurrentProject falls back to the full list when no project fingerprint is set", () => {
    saveTodos([])
    setCurrentProjectFingerprint("")
    upsertTodo({ content: "todo with no project context" })
    const scoped = loadTodosForCurrentProject()
    assert.strictEqual(scoped.length, 1)
  })
})
