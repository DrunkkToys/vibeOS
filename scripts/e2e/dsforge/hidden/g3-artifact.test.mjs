// SPDX-License-Identifier: MIT
// D2: the artifact filter matches one error shape.
//
// The real audit removed 123 rows whose completion was an API error body captured as
// if it were an answer. The shipped filter tests startsWith('{"error"'), so a leading
// space, a newline, a pretty-printed body, or a different error key all get through.
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadRaw } from "../src/load.mjs"
import { build } from "../src/pipeline.mjs"

const RAW = fileURLToPath(new URL("../raw", import.meta.url))

function allRows(splits) {
  return [...splits.train, ...splits.valid, ...splits.test]
}

// An artifact is a completion that is a JSON object rather than prose. Training rows
// in this corpus are prose, so parsing as an object is the signal -- independent of
// which key the provider happened to use.
function isJsonObject(text) {
  const s = String(text ?? "").trim()
  if (!s.startsWith("{") && !s.startsWith("[")) return false
  try {
    const v = JSON.parse(s)
    return v !== null && typeof v === "object"
  } catch {
    return false
  }
}

test("no completion is a serialised API error", () => {
  const { splits } = build(loadRaw(RAW))
  const bad = allRows(splits).filter((r) => isJsonObject(r.completion))
  assert.equal(bad.length, 0, `${bad.length} JSON artifacts survived, e.g. ${bad[0]?.id}: ${bad[0]?.completion?.slice(0, 60)}`)
})

test("the filter is not defeated by leading whitespace", () => {
  const { splits } = build(loadRaw(RAW))
  const led = allRows(splits).filter((r) => /^\s+[{[]/.test(String(r.completion ?? "")))
  assert.equal(led.length, 0, `${led.length} rows start with whitespace then a JSON body`)
})

test("the filter is not tied to one error key", () => {
  const { splits } = build(loadRaw(RAW))
  const keyed = allRows(splits).filter((r) => /"(error|message|detail)"\s*:/.test(String(r.completion ?? "")))
  assert.equal(keyed.length, 0, `${keyed.length} rows carry an error payload under a key the filter ignores`)
})
