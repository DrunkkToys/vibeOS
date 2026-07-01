import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../pattern-store.js';

describe('pattern-store', () => {
  it('smoke: module loads', () => {
    assert.ok(mod);
  });
});
