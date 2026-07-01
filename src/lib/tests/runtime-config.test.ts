import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../runtime-config.js';

describe('runtime-config', () => {
  it('smoke: module loads', () => {
    assert.ok(mod);
  });

  it('tierAgentForSlot is exported', () => {
    assert.equal(typeof mod.tierAgentForSlot, 'function');
  });

  it('buildVibePrimaryAgent is exported', () => {
    assert.equal(typeof mod.buildVibePrimaryAgent, 'function');
  });

  it('buildVibeTierAgent is exported', () => {
    assert.equal(typeof mod.buildVibeTierAgent, 'function');
  });

  it('collectOpenCodeConfigPaths is exported', () => {
    assert.equal(typeof mod.collectOpenCodeConfigPaths, 'function');
  });

  it('cleanupLegacyOpenCodeConfigFiles is exported', () => {
    assert.equal(typeof mod.cleanupLegacyOpenCodeConfigFiles, 'function');
  });

  it('readOpenCodeConfig is exported', () => {
    assert.equal(typeof mod.readOpenCodeConfig, 'function');
  });

  it('writeOpenCodeConfig is exported', () => {
    assert.equal(typeof mod.writeOpenCodeConfig, 'function');
  });

  it('installVibeTierAgentsInConfig is exported', () => {
    assert.equal(typeof mod.installVibeTierAgentsInConfig, 'function');
  });

  it('installVibeTierAgents is exported', () => {
    assert.equal(typeof mod.installVibeTierAgents, 'function');
  });

  it('readDefaultAgent is exported', () => {
    assert.equal(typeof mod.readDefaultAgent, 'function');
  });

  it('runtimeTierCoherence is exported', () => {
    assert.equal(typeof mod.runtimeTierCoherence, 'function');
  });

  it('VIBE_PRIMARY_AGENT is exported', () => {
    assert.ok(mod.VIBE_PRIMARY_AGENT);
  });

  it('VIBE_TIER_AGENT_BY_SLOT is exported', () => {
    assert.ok(mod.VIBE_TIER_AGENT_BY_SLOT);
  });
});
