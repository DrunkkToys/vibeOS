// SPDX-License-Identifier: MIT
// DEEP TEST 4: Report tools — saveReport, listReports, readReport CRUD cycle
import test from "node:test"
import assert from "node:assert/strict"

const mod = await import("../dist/vibeOS.js")
const { saveReport, listReports, readReport } = mod

// saveReport deduplicates by (type, summary, dedupScope).
// We pass a unique summary per test AND a fingerprint to avoid dedup collisions.

let testCounter = 0

test("report: saveReport returns string ID for unique content", () => {
  testCounter++
  const id = saveReport({
    type: "manual",
    summary: "deep-test-" + Date.now() + "-" + testCounter,
    findings: ["Test findings for deep report test"],
    metrics: { assertions: 42, passed: 40, failed: 2 },
    narrative: "This is a test narrative",
    fingerprint: "deep-test-fp-" + testCounter,
  })
  assert.equal(typeof id, "string", "saveReport returns string")
  assert.ok(id.length > 0, "ID is non-empty")
})

test("report: listReports returns array after save", () => {
  testCounter++
  saveReport({
    type: "manual",
    summary: "list-test-" + Date.now() + "-" + testCounter,
    findings: ["list test content"],
    metrics: { count: 1 },
    fingerprint: "list-test-fp-" + testCounter,
  })
  const reports = listReports()
  assert.ok(Array.isArray(reports), "listReports returns array")
  assert.ok(reports.length > 0, "at least one report exists")
})

test("report: readReport returns saved content with correct meta", () => {
  testCounter++
  const id = saveReport({
    type: "manual",
    summary: "read-test-" + Date.now() + "-" + testCounter,
    findings: ["read test findings"],
    metrics: { count: 99 },
    fingerprint: "read-test-fp-" + testCounter,
  })
  assert.ok(id, "saveReport returned ID")
  const report = readReport(id)
  assert.ok(report, "readReport returns truthy")
  assert.equal(typeof report, "object", "report is object")
  assert.ok(report.meta, "report has meta field")
  assert.equal(report.meta.id, id, "meta.id matches saved ID")
  assert.equal(report.meta.type, "manual", "meta.type is manual")
})

test("report: save multiple reports and list them", () => {
  const ids = []
  for (let i = 0; i < 3; i++) {
    const id = saveReport({
      type: "manual",
      summary: "multi-report-" + Date.now() + "-" + i,
      findings: ["finding " + i],
      metrics: { count: i },
      fingerprint: "multi-fp-" + Date.now() + "-" + i,
    })
    if (id) ids.push(id)
  }
  assert.ok(ids.length > 0, "at least one report was saved")
  const reports = listReports()
  assert.ok(reports.length >= ids.length, "list contains at least the saved reports")
  const listIds = reports.map(r => r.id)
  for (const id of ids) {
    assert.ok(listIds.includes(id), "saved ID " + id + " found in list")
  }
})

test("report: readReport for non-existent ID returns null/undefined", () => {
  const report = readReport("non-existent-id-99999")
  assert.ok(report === null || report === undefined, "non-existent report returns null/undefined")
})

test("report: report meta has expected fields", () => {
  testCounter++
  const id = saveReport({
    type: "manual",
    summary: "meta-test-" + Date.now() + "-" + testCounter,
    findings: ["meta check"],
    metrics: {},
    fingerprint: "meta-fp-" + testCounter,
  })
  assert.ok(id, "saveReport returned ID")
  const report = readReport(id)
  assert.ok(report.meta.project !== undefined, "meta has project")
  assert.ok(report.meta.created, "meta has created timestamp")
  assert.ok(report.meta.sessionId, "meta has sessionId")
})

test("report: saveReport deduplicates same type+summary+scope", () => {
  const summary = "dedup-test-" + Date.now()
  const fp = "dedup-fp-" + Date.now()
  const id1 = saveReport({ type: "manual", summary, findings: ["A"], fingerprint: fp })
  const id2 = saveReport({ type: "manual", summary, findings: ["B"], fingerprint: fp })
  assert.ok(id1, "first save returns ID")
  assert.equal(id2, null, "second save with same type+summary+fingerprint returns null (dedup)")
})

test("report: different summary avoids dedup", () => {
  const fp = "diff-fp-" + Date.now()
  const id1 = saveReport({ type: "manual", summary: "unique-A-" + Date.now(), findings: ["A"], fingerprint: fp })
  const id2 = saveReport({ type: "manual", summary: "unique-B-" + Date.now(), findings: ["B"], fingerprint: fp })
  assert.ok(id1, "first save returns ID")
  assert.ok(id2, "second save with different summary returns ID")
  assert.ok(id1 !== id2, "IDs are different")
})
