// SPDX-License-Identifier: MIT
// Contract: appendJsonlWithRotation must cap unbounded jsonl growth (the
// calibration-data.jsonl / session-health.jsonl / loop-audit.jsonl /
// turn-ledger.jsonl files were observed growing to multiple MB with no
// rotation) without losing recent entries or corrupting the file mid-write.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appendJsonlWithRotation } from "../fs-helpers.js"

test("appendJsonlWithRotation trims the file once it exceeds maxLines, keeping the newest entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-rotation-"))
  const file = join(dir, "log.jsonl")
  try {
    for (let i = 0; i < 250; i++) {
      appendJsonlWithRotation(file, JSON.stringify({ i }) + "\n", 50, 50)
    }
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean)
    assert.ok(lines.length <= 50, `expected trimmed file to have <=50 lines, got ${lines.length}`)
    const parsed = lines.map((l) => JSON.parse(l))
    assert.equal(parsed[parsed.length - 1].i, 249, "the most recent entry must survive rotation")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("appendJsonlWithRotation never drops entries below maxLines", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-rotation-"))
  const file = join(dir, "log.jsonl")
  try {
    for (let i = 0; i < 5; i++) {
      appendJsonlWithRotation(file, JSON.stringify({ i }) + "\n", 100, 10)
    }
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean)
    assert.equal(lines.length, 5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
