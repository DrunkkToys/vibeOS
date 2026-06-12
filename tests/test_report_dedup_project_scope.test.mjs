import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const home = mkdtempSync(join(tmpdir(), "vibeos-report-dedup-"))
mkdirSync(join(home, ".claude"), { recursive: true })
process.env.HOME = home
process.env.VIBEOS_HOME = join(home, ".claude")

const reporting = await import("../src/lib/reporting.js?t=" + Date.now())

test("report dedup is scoped to project identity", () => {
  reporting.setReportingContext({ fingerprint: "fp-a", projectName: "Project A", sessionId: "sid-a" })
  const first = reporting.saveReport({
    type: "session",
    summary: "same summary across projects",
    metrics: { projectName: "Project A", projectFingerprint: "fp-a", sessionId: "sid-a" },
  })

  reporting.setReportingContext({ fingerprint: "fp-b", projectName: "Project B", sessionId: "sid-b" })
  const second = reporting.saveReport({
    type: "session",
    summary: "same summary across projects",
    metrics: { projectName: "Project B", projectFingerprint: "fp-b", sessionId: "sid-b" },
  })

  const index = JSON.parse(readFileSync(join(home, ".claude", "reports", "index.json"), "utf8"))
  assert.ok(first, "first report should save")
  assert.ok(second, "same summary in a different project should not dedup away")
  assert.equal(index.reports.filter((r) => r.summary === "same summary across projects").length, 2, "both reports should be retained")
})
