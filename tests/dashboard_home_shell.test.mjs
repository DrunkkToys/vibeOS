import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { DEFAULT_SELECTION_KIND, inferProjectIcon, resolveFlowSummary } from "../src/lib/dashboard/src/home-model.js"

const ROOT = join(import.meta.dirname, "..")

test("dashboard home shell defaults to Home selection", () => {
  assert.equal(DEFAULT_SELECTION_KIND, "home")

  const appSource = readFileSync(join(ROOT, "src/lib/dashboard/src/App.tsx"), "utf8")
  assert.ok(appSource.includes('fetchDashboardHome'), "App should fetch dashboard home data")
  assert.ok(appSource.includes('selection().kind === "home"'), "App should render Home as the primary view")

  const sidebarSource = readFileSync(join(ROOT, "src/lib/dashboard/src/components/Sidebar.tsx"), "utf8")
  assert.ok(sidebarSource.includes('kind: "home"'), "Sidebar should expose a Home selection")
  assert.ok(sidebarSource.includes("Home"), "Sidebar should label the pinned Home entry")
})

test("project icon inference is stable and falls back cleanly", () => {
  const uiIcon = inferProjectIcon({ name: "Dashboard UI", fingerprint: "abc" })
  assert.equal(uiIcon.glyph, "◩")

  const stableA = inferProjectIcon({ name: "", fingerprint: "same-fingerprint" })
  const stableB = inferProjectIcon({ name: "", fingerprint: "same-fingerprint" })
  assert.deepEqual(stableA, stableB)

  const initials = inferProjectIcon({ name: "the Saver", fingerprint: "" })
  assert.equal(initials.glyph, "TS")
})

test("flow summary surfaces session override, project default, and global fallback", () => {
  const flows = [
    { id: "global-1", name: "Global Base", scope: "global", project_id: null },
    { id: "project-1", name: "Project Flow", scope: "project", project_id: "p1" },
    { id: "session-1", name: "Session Override", scope: "project", project_id: "p1" },
  ]

  assert.equal(
    resolveFlowSummary({
      session: { flow_id: "session-1", project_id: "p1" },
      project: { default_flow_id: "project-1" },
      flows,
    }),
    "Session Override (session override)"
  )

  assert.equal(
    resolveFlowSummary({
      session: { flow_id: null, project_id: "p1" },
      project: { default_flow_id: "project-1" },
      flows,
    }),
    "Project Flow (project default)"
  )

  assert.equal(
    resolveFlowSummary({
      session: { flow_id: null, project_id: "p1" },
      project: { default_flow_id: null },
      flows,
    }),
    "Global Base (global default)"
  )
})
