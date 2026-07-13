import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

// Regression: PR #452 scoped `vibe todo` (trinity-tool.ts) to the current project via
// loadTodosForCurrentProject(), but the dashboard/MCP server's _dashboardSyncDeps in
// src/index.ts still wired both `todos` (status payload) and `getTodos` (dashboard
// home model) to the raw, unscoped loadTodos(). Live-confirmed: `vibe dashboard`'s
// http://127.0.0.1:<port>/dashboard/home reported "TODOs": 1609 with entries from an
// unrelated project (VibeBrainUltra), the exact same leak class PR #452 was meant to
// close, just through a second code path PR #452 didn't touch.
describe("dashboard/MCP server todo scoping", () => {
  const src = readFileSync(join(ROOT, "src/index.ts"), "utf8")

  it("the dashboard status payload's todos field uses loadTodosForCurrentProject()", () => {
    assert.ok(
      src.includes("todos: loadTodosForCurrentProject(),"),
      "status payload must scope todos to the current project, not the raw global list"
    )
  })

  it("the dashboard deps' getTodos() uses loadTodosForCurrentProject()", () => {
    assert.ok(
      src.includes("getTodos: () => loadTodosForCurrentProject(),"),
      "dashboard home model's getTodos must scope todos to the current project"
    )
  })

  it("no remaining unscoped loadTodos() call sites feed the dashboard sync deps", () => {
    const dashboardDepsSection = src.slice(
      src.indexOf("_dashboardSyncDeps = {"),
      src.indexOf("_dashboardSyncDeps = {") + src.slice(src.indexOf("_dashboardSyncDeps = {")).indexOf("ensureMcpServerRunning") + 200
    )
    assert.ok(
      !/[^s]todos:\s*loadTodos\(\)/.test(dashboardDepsSection),
      "dashboard sync deps must not read the unscoped global todo list"
    )
    assert.ok(
      !/getTodos:\s*\(\)\s*=>\s*loadTodos\(\)/.test(dashboardDepsSection),
      "dashboard sync deps must not read the unscoped global todo list"
    )
  })
})
