// SPDX-License-Identifier: MIT
// D3: de-duplication keyed on id, not on content.
//
// The real audit hit this as "dedup before 4,859, after 4,858" -- a pass that removed
// exactly one row and reported success, while ten content duplicates carrying fresh
// ids went straight into training. dsforge.config.json names the key: prompt+completion.
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))

function allRows(splits) {
  return [...splits.train, ...splits.valid, ...splits.test]
}

test("no prompt+completion pair survives twice", () => {
  const { splits } = build(loadRaw(RAW))
  const seen = new Map()
  for (const r of allRows(splits)) {
    const key = `${r.prompt}\u0000${r.completion}`
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1)
  assert.equal(dupes.length, 0, `${dupes.length} duplicated prompt+completion pairs remain`)
})

test("no id survives twice", () => {
  const { splits } = build(loadRaw(RAW))
  const ids = allRows(splits).map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, "an id appears in more than one output row")
})

test("the report does not overstate what de-duplication removed", () => {
  const rows = loadRaw(RAW)
  const { splits, report } = build(rows)
  const kept = allRows(splits).length
  assert.equal(report.dedup.after, kept, "report.dedup.after must equal the rows actually emitted")
  assert.ok(
    report.dedup.before - report.dedup.after >= 10,
    `the corpus contains 11 content duplicates; the report claims ${report.dedup.before - report.dedup.after} removed`,
  )
})
