// SPDX-License-Identifier: MIT
// D5 (PIVOT): splits are sliced in corpus order, so a label sitting together in the
// file lands entirely in one split.
//
// This is the real report's "math: 4 rows, writing: 1 row" made measurable: a label
// that never reaches valid or test cannot be validated, and per-label accuracy on it
// is undefined. The requirement is introduced in turn 4 and not before.
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))

const counts = (rows) => {
  const c = {}
  for (const r of rows) c[r.label] = (c[r.label] || 0) + 1
  return c
}

test("every label present in the corpus reaches all three splits", () => {
  const { splits } = build(loadRaw(RAW))
  const all = [...splits.train, ...splits.valid, ...splits.test]
  const labels = Object.keys(counts(all))
  assert.ok(labels.length >= 5, `expected the corpus to carry several labels, saw ${labels.length}`)
  const missing = []
  for (const name of ["train", "valid", "test"]) {
    const present = new Set(splits[name].map((r) => r.label))
    for (const label of labels) if (!present.has(label)) missing.push(`${label} absent from ${name}`)
  }
  assert.deepEqual(missing, [], missing.join("; "))
})

test("rare labels are not concentrated in a single split", () => {
  const { splits } = build(loadRaw(RAW))
  const all = [...splits.train, ...splits.valid, ...splits.test]
  const total = counts(all)
  const offenders = []
  for (const [label, n] of Object.entries(total)) {
    if (n < 3) continue
    for (const name of ["train", "valid", "test"]) {
      const inSplit = splits[name].filter((r) => r.label === label).length
      if (inSplit === n) offenders.push(`${label}: all ${n} rows in ${name}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "))
})

test("stratifying did not break the configured split sizes", () => {
  const { splits } = build(loadRaw(RAW))
  const n = splits.train.length + splits.valid.length + splits.test.length
  // Per-label rounding moves a few rows between buckets; the split must still be
  // recognisably 70/15/15 rather than reverting to equal thirds or to one bucket.
  assert.ok(Math.abs(splits.train.length / n - 0.7) < 0.06, `train share ${(splits.train.length / n).toFixed(3)}`)
  assert.ok(Math.abs(splits.valid.length / n - 0.15) < 0.06, `valid share ${(splits.valid.length / n).toFixed(3)}`)
  assert.ok(Math.abs(splits.test.length / n - 0.15) < 0.06, `test share ${(splits.test.length / n).toFixed(3)}`)
})
