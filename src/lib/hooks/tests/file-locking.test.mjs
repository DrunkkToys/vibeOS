import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withFileLock, FILE_LOCK_DIR } from '../../state.js';

function lockPathFor(filePath) {
  const hash = createHash('sha1').update(String(filePath || '')).digest('hex');
  return join(FILE_LOCK_DIR, `${hash}.lock`);
}

describe('withFileLock', () => {
  it('acquires lock and returns callback value', () => {
    const path = '/tmp/test-lock-simple-' + Date.now() + '-' + Math.random();
    const result = withFileLock(path, () => 'done');
    assert.strictEqual(result, 'done');
  });

  it('concurrent lock contention throws', async () => {
    const path = '/tmp/test-lock-contention-' + Date.now() + '-' + Math.random();
    await assert.rejects(
      async () => {
        withFileLock(path, () => {
          withFileLock(path, () => 'nested', { timeoutMs: 200 });
        }, { timeoutMs: 1000 });
      },
      /lock not acquired/
    );
  });

  it('cleans up stale lock file', () => {
    const path = '/tmp/test-lock-stale-' + Date.now() + '-' + Math.random();
    const lockPath = lockPathFor(path);
    mkdirSync(FILE_LOCK_DIR, { recursive: true });
    writeFileSync(lockPath, '12345\n0\n');
    utimesSync(lockPath, new Date(0), new Date(0));
    const result = withFileLock(path, () => 'stale-cleaned', { staleMs: 1 });
    assert.strictEqual(result, 'stale-cleaned');
  });

  it('removes lock file after callback completes', () => {
    const path = '/tmp/test-lock-cleanup-' + Date.now() + '-' + Math.random();
    const lockPath = lockPathFor(path);
    withFileLock(path, () => 'ok');
    assert.strictEqual(existsSync(lockPath), false);
  });

  it('removes lock file even when callback throws', async () => {
    const path = '/tmp/test-lock-error-' + Date.now() + '-' + Math.random();
    const lockPath = lockPathFor(path);
    await assert.rejects(
      async () => {
        withFileLock(path, () => { throw new Error('callback failed'); }, { timeoutMs: 100 });
      },
      /lock not acquired/
    );
    assert.strictEqual(existsSync(lockPath), false);
  });
});
