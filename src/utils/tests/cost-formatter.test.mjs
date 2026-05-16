import { describe, it } from 'node:test'
import assert from 'node:assert'
import { formatCost, getNumericCents, formatCentsAsDollars } from '../cost-formatter.js'

describe('getNumericCents', () => {
  it('returns number for number input', () => {
    assert.strictEqual(getNumericCents(50), 50)
  })

  it('returns 0 for null', () => {
    assert.strictEqual(getNumericCents(null), 0)
  })

  it('returns 0 for undefined', () => {
    assert.strictEqual(getNumericCents(undefined), 0)
  })

  it('parses string to number', () => {
    assert.strictEqual(getNumericCents('1.23'), 1.23)
  })

  it('returns 0 for non-numeric string', () => {
    assert.strictEqual(getNumericCents('abc'), 0)
  })
})

describe('formatCentsAsDollars', () => {
  it('$1.23 for 123 cents', () => {
    assert.strictEqual(formatCentsAsDollars(123), '$1.23')
  })

  it('$0.01 for one cent', () => {
    assert.strictEqual(formatCentsAsDollars(1), '$0.01')
  })

  it('$0.00 for zero', () => {
    assert.strictEqual(formatCentsAsDollars(0), '$0.00')
  })

  it('$10.99 for 1099 cents', () => {
    assert.strictEqual(formatCentsAsDollars(1099), '$10.99')
  })

  it('negative value prefixed with minus', () => {
    assert.strictEqual(formatCentsAsDollars(-50), '-$0.50')
  })

  it('$0.00 for null', () => {
    assert.strictEqual(formatCentsAsDollars(null), '$0.00')
  })
})

describe('formatCost', () => {
  it('$0.00 for zero', () => {
    assert.strictEqual(formatCost(0), '$0.00')
  })

  it('$0.01 for one cent', () => {
    assert.strictEqual(formatCost(1), '$0.01')
  })

  it('$1.00 for 100 cents', () => {
    assert.strictEqual(formatCost(100), '$1.00')
  })

  it('$0.99 for 99 cents', () => {
    assert.strictEqual(formatCost(99), '$0.99')
  })

  it('$10.99 for 1099 cents', () => {
    assert.strictEqual(formatCost(1099), '$10.99')
  })

  it('negative value prefixed with minus sign', () => {
    assert.strictEqual(formatCost(-50), '-$0.50')
  })

  it('rounds 0.5 cents to nearest cent', () => {
    assert.strictEqual(formatCost(0.5), '$0.01')
  })

  it('undefined → $0.00', () => {
    assert.strictEqual(formatCost(undefined), '$0.00')
  })

  it('null → $0.00', () => {
    assert.strictEqual(formatCost(null), '$0.00')
  })

  it('parses float from string then converts to cents', () => {
    assert.strictEqual(formatCost('1.23'), '$0.01')
  })

  it('large numbers', () => {
    assert.strictEqual(formatCost(100000), '$1000.00')
  })

  it('negative zero → $0.00', () => {
    assert.strictEqual(formatCost(-0), '$0.00')
  })

  it('non-numeric string → $0.00', () => {
    assert.strictEqual(formatCost('abc'), '$0.00')
  })
})
