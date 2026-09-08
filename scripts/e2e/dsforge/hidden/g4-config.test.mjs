// SPDX-License-Identifier: MIT
// D4: dsforge.config.json is never read.
//
// The config declares splitRatios 0.7/0.15/0.15 and the pipeline hardcodes
// 0.8/0.1/0.1. Nothing in src/ mentions the config file, so this is only findable by
// reading a file the modules never point at. README.md states the rounding rule.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))
const CONFIG = fileURLToPath(new URL("../dsforge.config.json", import.meta.url))

const config = JSON.parse(readFileSync(CONFIG, "utf-8"))

// Allocating per label (which turn 4 goes on to require) rounds within each label,
// so the global totals can drift by up to one row per label. The tolerance is that
// drift and no more: it still fails a pipeline using 0.8/0.1/0.1, which is 14 rows
// out on this corpus.
const SLACK = config.labels.length

test("split sizes follow the configured ratios", () => {
  const { splits } = build(loadRaw(RAW))
  const n = splits.train.length + splits.valid.length + splits.test.length
  const expectTrain = Math.floor(n * config.splitRatios.train)
  const expectValid = Math.floor(n * config.splitRatios.valid)
  assert.ok(Math.abs(splits.train.length - expectTrain) <= SLACK, `train ${splits.train.length}, configured ratio wants about ${expectTrain}`)
  assert.ok(Math.abs(splits.valid.length - expectValid) <= SLACK, `valid ${splits.valid.length}, configured ratio wants about ${expectValid}`)
  assert.equal(splits.train.length + splits.valid.length + splits.test.length, n, "splitting must not lose or invent rows")
})

test("changing the configured ratios changes the split", async () => {
  // The point of reading config is that it is read. A pipeline that happens to match
  // the numbers while ignoring the file passes the previous test and fails this one.
  const original = readFileSync(CONFIG, "utf-8")
  try {
    writeFileSync(CONFIG, JSON.stringify({ ...config, splitRatios: { train: 0.5, valid: 0.25, test: 0.25 } }, null, 2) + "\n")
    const mod = await import(`../src/pipeline.mjs?cfg=${Date.now()}`)
    const { splits } = mod.build(loadRaw(RAW))
    const n = splits.train.length + splits.valid.length + splits.test.length
    assert.ok(Math.abs(splits.train.length - Math.floor(n * 0.5)) <= SLACK, `train ${splits.train.length} of ${n} must follow the file, not a constant`)
  } finally {
    writeFileSync(CONFIG, original)
  }
})

test("every configured label is known to the report", () => {
  const { report } = build(loadRaw(RAW))
  for (const label of config.labels) {
    assert.ok(label in report.labels, `report.labels is missing the configured label "${label}"`)
  }
})
