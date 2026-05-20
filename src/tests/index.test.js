import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/index.js');

describe('vibeOS plugin module', () => {
  it('exports id as "vibeOS"', () => {
    assert.equal(mod.id, 'vibeOS');
  });

  it('exports server as a function', () => {
    assert.equal(typeof mod.server, 'function');
  });

  it('exports default with correct shape', () => {
    assert.equal(mod.default.id, 'vibeOS');
    assert.equal(typeof mod.default.server, 'function');
  });

  it('exports applySlot as function', () => {
    assert.equal(typeof mod.applySlot, 'function');
  });

  it('exports modelCostPerTurn as function', () => {
    assert.equal(typeof mod.modelCostPerTurn, 'function');
  });

  it('exports isModelFree as function', () => {
    assert.equal(typeof mod.isModelFree, 'function');
  });

  it('exports isDocsTarget as function', () => {
    assert.equal(typeof mod.isDocsTarget, 'function');
  });

  it('exports closeMcpServer as function', () => {
    assert.equal(typeof mod.closeMcpServer, 'function');
  });

  it('exports DelegationEnforcer as function', () => {
    assert.equal(typeof mod.DelegationEnforcer, 'function');
  });

  it('exports buildTestReminder as function', () => {
    assert.equal(typeof mod.buildTestReminder, 'function');
  });

  it('exports buildTestSkeleton as function', () => {
    assert.equal(typeof mod.buildTestSkeleton, 'function');
  });

  it('exports classifyAndRankModels as function', () => {
    assert.equal(typeof mod.classifyAndRankModels, 'function');
  });

  it('exports detectContext7 as function', () => {
    assert.equal(typeof mod.detectContext7, 'function');
  });

  it('exports enforceTestFile as function', () => {
    assert.equal(typeof mod.enforceTestFile, 'function');
  });

  it('exports extractExports as function', () => {
    assert.equal(typeof mod.extractExports, 'function');
  });

  it('exports getScratchpadHit as function', () => {
    assert.equal(typeof mod.getScratchpadHit, 'function');
  });

  it('exports listReports as function', () => {
    assert.equal(typeof mod.listReports, 'function');
  });

  it('exports modelToCcAlias as function', () => {
    assert.equal(typeof mod.modelToCcAlias, 'function');
  });

  it('exports readReport as function', () => {
    assert.equal(typeof mod.readReport, 'function');
  });

  it('exports researchAudit as function', () => {
    assert.equal(typeof mod.researchAudit, 'function');
  });

  it('exports saveReport as function', () => {
    assert.equal(typeof mod.saveReport, 'function');
  });
});
