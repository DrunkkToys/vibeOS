import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isModelFree, modelCostPerTurn, closeMcpServer } from '../../index.js';

describe('standalone exported functions', () => {
  it('isModelFree returns false for unknown model', () => {
    assert.equal(isModelFree('unknown-model-test'), false);
  });

  it('modelCostPerTurn returns null for unknown model', () => {
    assert.equal(modelCostPerTurn('unknown-model-test'), null);
  });

  it('isModelFree returns boolean for known models', () => {
    const result = isModelFree('claude-3-haiku');
    assert.equal(typeof result, 'boolean');
  });

  it('closeMcpServer is callable without error', async () => {
    await closeMcpServer();
  });
});
