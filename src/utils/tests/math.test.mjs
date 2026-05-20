import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roundTo } from '../math.js';

describe('math utilities', () => {
  it('roundTo rounds to 2 decimal places by default', () => {
    assert.equal(roundTo(1.234, 2), 1.23);
  });
  it('roundTo rounds to specified decimals', () => {
    assert.equal(roundTo(1.234, 1), 1.2);
    assert.equal(roundTo(1.234, 0), 1);
  });
  it('roundTo handles zero', () => {
    assert.equal(roundTo(0, 2), 0);
  });
  it('roundTo handles negative numbers', () => {
    assert.equal(roundTo(-1.234, 2), -1.23);
  });
  it('roundTo returns 0 for null input', () => {
    assert.equal(roundTo(null, 2), 0);
  });
  it('roundTo returns NaN for undefined input', () => {
    assert.ok(Number.isNaN(roundTo(undefined, 2)));
  });
});
