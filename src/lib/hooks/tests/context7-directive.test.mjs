import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const BASE_PREFIX = "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs"

const { context7Directive } = await import('../chat-transform.js')

describe('context7Directive', () => {
  it('required urgency includes CRITICAL directive', () => {
    const result = context7Directive({ context7_urgency: "required" })
    assert.ok(result.includes("CRITICAL: context7 usage is REQUIRED this turn."))
  })

  it('optional urgency includes optional note', () => {
    const result = context7Directive({ context7_urgency: "optional" })
    assert.ok(result.includes("context7 is optional this turn"))
  })

  it('preferred urgency has no suffix', () => {
    const result = context7Directive({ context7_urgency: "preferred" })
    assert.ok(!result.includes("CRITICAL"))
    assert.ok(!result.includes("optional"))
  })

  it('null control vector falls back to preferred behavior', () => {
    const result = context7Directive(null)
    assert.ok(!result.includes("CRITICAL"))
    assert.ok(!result.includes("optional"))
  })

  it('empty urgency string falls back to preferred', () => {
    const result = context7Directive({ context7_urgency: "" })
    assert.ok(!result.includes("CRITICAL"))
    assert.ok(!result.includes("optional"))
  })

  it('unknown urgency value produces base text only', () => {
    const result = context7Directive({ context7_urgency: "invalid_unknown_value" })
    assert.ok(!result.includes("CRITICAL"))
    assert.ok(!result.includes("optional"))
  })

  it('base text is always present regardless of urgency', () => {
    assert.ok(context7Directive({ context7_urgency: "required" }).startsWith(BASE_PREFIX))
    assert.ok(context7Directive({ context7_urgency: "optional" }).startsWith(BASE_PREFIX))
    assert.ok(context7Directive({ context7_urgency: "preferred" }).startsWith(BASE_PREFIX))
    assert.ok(context7Directive(null).startsWith(BASE_PREFIX))
  })

  it('cache bypass — different urgency values each produce correct output', () => {
    const r1 = context7Directive({ context7_urgency: "required" })
    assert.ok(r1.includes("REQUIRED"))
    assert.ok(!r1.includes("optional"))

    const r2 = context7Directive({ context7_urgency: "optional" })
    assert.ok(r2.includes("optional"))
    assert.ok(!r2.includes("REQUIRED"))

    const r3 = context7Directive({ context7_urgency: "preferred" })
    assert.ok(!r3.includes("optional"))
    assert.ok(!r3.includes("REQUIRED"))
  })
})
