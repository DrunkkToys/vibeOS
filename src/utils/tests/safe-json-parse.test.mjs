import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeJsonParse } from '../../lib/state.js';

describe('safeJsonParse', () => {
  it('returns null for null input', () => {
    assert.equal(safeJsonParse(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(safeJsonParse(undefined), null);
  });

  it('returns null for empty string', () => {
    assert.equal(safeJsonParse(''), null);
  });

  it('parses valid JSON object', () => {
    assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  });

  it('parses valid JSON array', () => {
    assert.deepEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
  });

  it('handles trailing comma in object', () => {
    assert.deepEqual(safeJsonParse('{"a":1,}'), { a: 1 });
  });

  it('handles trailing comma in multi-key object', () => {
    assert.deepEqual(safeJsonParse('{"a":1,"b":2,}'), { a: 1, b: 2 });
  });

  it('handles trailing comma in array', () => {
    assert.deepEqual(safeJsonParse('[1,2,]'), [1, 2]);
  });

  it('handles nested trailing commas', () => {
    assert.deepEqual(safeJsonParse('[1,[2,],]'), [1, [2]]);
  });

  it('handles single-line comment', () => {
    assert.deepEqual(safeJsonParse('{"a":1 // comment\n}'), { a: 1 });
  });

  it('handles block comment', () => {
    assert.deepEqual(safeJsonParse('{"a":1 /* comment */}'), { a: 1 });
  });

  it('handles multi-line block comment', () => {
    assert.deepEqual(safeJsonParse('{"a":1, /* line1\n line2 */ "b":2}'), { a: 1, b: 2 });
  });

  it('handles mixed trailing commas and comments', () => {
    assert.deepEqual(safeJsonParse('{"a":1, // comment\n "b":2,}'), { a: 1, b: 2 });
  });

  it('handles nested with comments', () => {
    assert.deepEqual(safeJsonParse('{"a":{"b":[1,2,/*c*/3,]}}'), { a: { b: [1, 2, 3] } });
  });

  it('returns null for malformed JSON', () => {
    assert.equal(safeJsonParse('{invalid}'), null);
  });

  it('returns null for gibberish', () => {
    assert.equal(safeJsonParse('not even close'), null);
  });

  it('returns null for whitespace only', () => {
    assert.equal(safeJsonParse('  '), null);
  });

  it('parses plain number', () => {
    assert.equal(safeJsonParse('42'), 42);
  });

  it('parses plain string JSON', () => {
    assert.equal(safeJsonParse('"hello"'), 'hello');
  });

  it('parses empty object', () => {
    assert.deepEqual(safeJsonParse('{}'), {});
  });

  it('parses empty array', () => {
    assert.deepEqual(safeJsonParse('[]'), []);
  });
});
