// SPDX-License-Identifier: MIT
// D1: the echo filter compares raw strings.
//
// The real audit removed 45 rows whose completion was the prompt back again. Three of
// the eleven here are byte-identical, which the shipped filter does catch -- that is
// what makes it look alive. The other eight differ only by trailing whitespace.
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()

function allRows(splits) {
  return [...splits.train, ...splits.valid, ...splits.test]
}

test("no completion merely echoes its prompt", () => {
  const { splits } = build(loadRaw(RAW))
  const echoes = allRows(splits).filter((r) => norm(r.completion) === norm(r.prompt))
  assert.equal(echoes.length, 0, `${echoes.length} echo rows survived, e.g. ${echoes[0]?.id}`)
})

test("whitespace is not a way past the echo filter", () => {
  const { splits } = build(loadRaw(RAW))
  const soft = allRows(splits).filter((r) => r.completion !== r.prompt && norm(r.completion) === norm(r.prompt))
  assert.equal(soft.length, 0, `${soft.length} rows differ from their prompt only by whitespace or case`)
})

test("no completion is empty once cleaning has run", () => {
  const { splits } = build(loadRaw(RAW))
  const empty = allRows(splits).filter((r) => !String(r.completion ?? "").trim())
  assert.equal(empty.length, 0, `${empty.length} rows have an empty completion`)
})
