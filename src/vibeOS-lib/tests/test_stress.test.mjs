import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isModelFree, modelCostPerTurn, closeMcpServer } from '../../index.js';

describe('standalone exported functions', () => {
  it('isModelFree returns true for unknown model (free cost)', () => {
    assert.equal(isModelFree('unknown-model-test'), true);
  });

  it('modelCostPerTurn returns FREE_MODEL_TURN_USD for unknown model', () => {
    assert.equal(Math.round(modelCostPerTurn('unknown-model-test') * 1e12) / 1e12, 1e-10);
  });

  it('isModelFree returns boolean for known models', () => {
    const result = isModelFree('claude-3-haiku');
    assert.equal(typeof result, 'boolean');
  });

  it('closeMcpServer is callable without error', async () => {
    await closeMcpServer();
  });
});
