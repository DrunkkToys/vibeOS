import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setShellDirectory, onShellEnv } from '../shell-env.js';

describe('setShellDirectory', () => {
  it('is a function', () => {
    assert.equal(typeof setShellDirectory, 'function');
  });

  it('can be called with a path', () => {
    assert.doesNotThrow(() => setShellDirectory('/tmp'));
  });
});

describe('onShellEnv', () => {
  it('runs without throwing', async () => {
    const input = {};
    const output = { env: {} };
    await assert.doesNotReject(() => onShellEnv(input, output));
  });

  it('mutates output.env with expected env vars', async () => {
    const input = {};
    const output = { env: {} };
    await onShellEnv(input, output);
    const env = output.env as Record<string, string>;
    assert.ok(typeof env.OPENCODE_MODEL_TIER === 'string');
    assert.ok(typeof env.OPENCODE_MODEL === 'string');
    assert.ok(typeof env.VIBEOS_SHELL_BADGE === 'string');
  });
});
