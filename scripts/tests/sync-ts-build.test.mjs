import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('sync-ts-build script', () => {
  it('module loads without error', async () => {
    const mod = await import('../../scripts/sync-ts-build.mjs');
    assert.ok(mod);
  });
});
