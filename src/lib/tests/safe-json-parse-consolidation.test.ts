import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { safeJsonParse as fromState } from "../state.js"
import { safeJsonParse as fromFsHelpers } from "../../utils/fs-helpers.js"

describe("safeJsonParse consolidation", () => {
  it("state re-exports the single canonical fs-helpers implementation", () => {
    assert.equal(
      fromState,
      fromFsHelpers,
      "src/lib/state.ts must re-export the canonical safeJsonParse from src/utils/fs-helpers.ts (one definition, not a copy)",
    )
  })

  it("canonical parser returns null (never throws) on garbage and empty input", () => {
    assert.equal(fromFsHelpers("not json at all"), null)
    assert.equal(fromFsHelpers(""), null)
    assert.equal(fromFsHelpers(null as unknown as string), null)
    assert.deepEqual(fromFsHelpers('{"a":1,}'), { a: 1 })
    assert.deepEqual(fromFsHelpers('{"a":1 // c\n}'), { a: 1 })
  })
})
