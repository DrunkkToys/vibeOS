// @ts-nocheck
// Flow-enforcer TODO persistence (todos.json). Split out of state.ts
// (Phase D file-size cleanup). Computes its path fresh via getVibeOSHome()
// on every call rather than importing a snapshotted `let` from state.ts.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { safeJsonParse } from "../../utils/fs-helpers.js"
import { getVibeOSHome } from "../runtime-paths.js"

type TodoEntry = {
  id: string
  content: string
  status: "pending" | "done" | "wontfix"
  filePath: string
  priority: "low" | "medium" | "high" | "critical"
  source: "manual" | "flow" | "intercepted"
  createdAt: string
  updatedAt: string
}

function getTodosFile(): string { return join(getVibeOSHome(), "todos.json") }

export function loadTodos(): TodoEntry[] {
  try {
    const todosFile = getTodosFile()
    if (!existsSync(todosFile)) return []
    const raw = readFileSync(todosFile, "utf-8")
    const parsed = safeJsonParse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function saveTodos(todos: TodoEntry[]): void {
  try {
    const todosFile = getTodosFile()
    mkdirSync(dirname(todosFile), { recursive: true })
    const tmp = todosFile + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(todos, null, 2), "utf-8")
    renameSync(tmp, todosFile)
  } catch {}
}

export function upsertTodo(entry: Partial<TodoEntry> & { content: string }): void {
  const todos = loadTodos()
  const existing = todos.findIndex(t =>
    t.content === entry.content &&
    (entry.filePath ? t.filePath === entry.filePath : true),
  )
  const newEntry: TodoEntry = {
    id: entry.id || crypto.randomUUID?.() || "todo-" + Date.now(),
    content: entry.content,
    status: (entry.status as TodoEntry["status"]) || "pending",
    filePath: entry.filePath || "",
    priority: (entry.priority as TodoEntry["priority"]) || "medium",
    source: (entry.source as TodoEntry["source"]) || "manual",
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing >= 0) {
    todos[existing] = { ...todos[existing], ...newEntry, updatedAt: new Date().toISOString() }
  } else {
    todos.push(newEntry)
  }
  saveTodos(todos)
}

export function markTodoDone(id: string): void {
  const todos = loadTodos()
  const found = todos.find(t => t.id === id)
  if (found) { found.status = "done"; found.updatedAt = new Date().toISOString(); saveTodos(todos) }
}

export function getTodos(): TodoEntry[] {
  return loadTodos()
}
