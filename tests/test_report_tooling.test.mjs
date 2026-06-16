import { describe, it, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const home = mkdtempSync(join(tmpdir(), "vibeos-report-tooling-"))
mkdirSync(join(home, ".claude"), { recursive: true })
process.env.HOME = home
process.env.VIBEOS_HOME = join(home, ".claude")

const { saveReport, listReports, readReport } = await import("../src/lib/reporting.js?t=" + Date.now())

after(() => {
  try { rmSync(home, { recursive: true, force: true }) } catch {}
})

describe("reportSave saves a report", () => {
  it("should return a valid id and create file on disk", () => {
    const id = saveReport({
      type: "manual",
      summary: "Save test — unique summary",
      findings: [{ severity: "info", topic: "Test", detail: "testing save" }],
      metrics: { value: 42 },
      narrative: "# Test Report\n\nThis is a test.",
      tags: ["test", "manual"],
      fingerprint: "fp-save-test",
    })
    assert.ok(id, "saveReport should return a truthy ID")
    const filePath = join(home, ".claude", "reports", `${id}.json`)
    assert.ok(existsSync(filePath), "Report file should exist on disk")
    const index = JSON.parse(readFileSync(join(home, ".claude", "reports", "index.json"), "utf8"))
    assert.ok(index.reports.some((r) => r.id === id), "Report should appear in index")
  })
})

describe("reportList returns saved reports", () => {
  it("should include a recently saved report filtered by fingerprint", () => {
    const id = saveReport({
      type: "session",
      summary: "List test — unique for list",
      fingerprint: "fp-list-test",
    })
    assert.ok(id, "saveReport should succeed")
    const reports = listReports({ fingerprint: "fp-list-test" })
    assert.ok(reports.length >= 1, "listReports should return at least 1 report")
    assert.ok(reports.some((r) => r.id === id), "The saved report ID should appear in the list")
  })
})

describe("reportRead reads saved report", () => {
  it("should return full report object with matching content", () => {
    const id = saveReport({
      type: "manual",
      summary: "Read test — verify content round-trip",
      findings: [{ severity: "warn", topic: "Performance", detail: "Slow query detected" }],
      metrics: { duration_ms: 1500 },
      narrative: "Detailed analysis of the performance issue.",
      tags: ["performance", "warn"],
      fingerprint: "fp-read-test",
    })
    assert.ok(id, "saveReport should succeed")
    const report = readReport(id)
    assert.ok(report, "readReport should return a report object")
    assert.equal(report.summary, "Read test — verify content round-trip")
    assert.equal(report.meta.type, "manual")
    assert.equal(report.meta.id, id)
    assert.equal(report.findings[0].topic, "Performance")
    assert.equal(report.metrics.duration_ms, 1500)
    assert.equal(report.narrative, "Detailed analysis of the performance issue.")
    assert.deepEqual(report.tags, ["performance", "warn"])
  })
})

describe("cross-project isolation", () => {
  it("should scope listed reports by fingerprint", () => {
    const idA = saveReport({
      type: "manual",
      summary: "Project A analysis",
      fingerprint: "fp-project-a",
    })
    const idB = saveReport({
      type: "manual",
      summary: "Project B analysis",
      fingerprint: "fp-project-b",
    })
    assert.ok(idA)
    assert.ok(idB)
    const listA = listReports({ fingerprint: "fp-project-a" })
    const listB = listReports({ fingerprint: "fp-project-b" })
    assert.ok(listA.some((r) => r.id === idA), "List A should include report A")
    assert.ok(!listA.some((r) => r.id === idB), "List A should NOT include report B")
    assert.ok(listB.some((r) => r.id === idB), "List B should include report B")
    assert.ok(!listB.some((r) => r.id === idA), "List B should NOT include report A")
  })
})
