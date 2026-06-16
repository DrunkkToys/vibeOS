import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { researchAudit } = await import('../../research-audit.js');

describe('researchAudit', () => {
  it('is a function', () => {
    assert.equal(typeof researchAudit, 'function');
  });

  it('returns expected structure with default args', () => {
    const result = researchAudit();
    assert.ok(result);
    assert.equal(typeof result, 'object');
    assert.ok('totalFetches' in result);
    assert.ok('totalBytes' in result);
    assert.ok('estCost' in result);
    assert.ok('chains' in result);
    assert.ok('byDomain' in result);
    assert.ok('sessions' in result);
    assert.ok('redundant' in result);
    assert.equal(typeof result.totalFetches, 'number');
    assert.equal(typeof result.estCost, 'number');
    assert.ok(Array.isArray(result.chains));
    assert.equal(typeof result.byDomain, 'object');
  });

  it('handles zero hours gracefully', () => {
    const result = researchAudit({ hours: 0 });
    assert.ok(result);
    assert.equal(typeof result.totalFetches, 'number');
    assert.ok(Array.isArray(result.chains));
  });

  it('handles negative hours gracefully', () => {
    const result = researchAudit({ hours: -1 });
    assert.ok(result);
    assert.equal(typeof result.totalFetches, 'number');
    assert.ok(Array.isArray(result.chains));
  });

  it('handles large hours value', () => {
    const result = researchAudit({ hours: 9999 });
    assert.ok(result);
    assert.equal(typeof result.totalFetches, 'number');
    assert.ok(Array.isArray(result.chains));
  });

  it('handles undefined gracefully via default param', () => {
    const result = researchAudit(undefined);
    assert.ok(result);
    assert.equal(typeof result.totalFetches, 'number');
  });

  it('handles session filter without crashing', () => {
    const result = researchAudit({ hours: 24, session: 'nonexistent-session-id' });
    assert.ok(result);
    assert.equal(typeof result.totalFetches, 'number');
    assert.ok(Array.isArray(result.chains));
  });
});
