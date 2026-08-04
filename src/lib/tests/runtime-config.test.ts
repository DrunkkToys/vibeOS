import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('runtime-config: uninstall marker', () => {
  const prevDir = process.env.VIBEOS_UNINSTALLED_MARKER_DIR;

  function withMarkerDir(dir) {
    process.env.VIBEOS_UNINSTALLED_MARKER_DIR = dir;
    return dir;
  }

  it('without a marker, installVibeTierAgents registers agents into the project config', () => {
    const markerDir = mkdtempSync(join(tmpdir(), 'vibe-marker-'));
    const proj = mkdtempSync(join(tmpdir(), 'vibe-proj-'));
    writeFileSync(join(proj, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json' }));
    process.env.VIBEOS_UNINSTALLED_MARKER_DIR = markerDir;
    try {
      assert.equal(mod.isVibeOSUninstalled(), false);
      const res = mod.installVibeTierAgents(proj, { cheap: { oc: 'x/c' }, medium: { oc: 'x/m' }, brain: { oc: 'x/b' } }, 'cheap', { includeGlobalHomes: false });
      assert.ok(res.changed.some((p) => p.includes('opencode.json')), 'agents should be registered without a marker');
    } finally {
      process.env.VIBEOS_UNINSTALLED_MARKER_DIR = prevDir;
    }
  });

  it('with a marker, installVibeTierAgents skips writing entirely', () => {
    const markerDir = withMarkerDir(mkdtempSync(join(tmpdir(), 'vibe-marker-')));
    const proj = mkdtempSync(join(tmpdir(), 'vibe-proj-'));
    const cfgPath = join(proj, 'opencode.json');
    writeFileSync(cfgPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json' }));
    try {
      writeFileSync(join(markerDir, mod.VIBEOS_UNINSTALLED_MARKER), 'uninstalled');
      assert.equal(mod.isVibeOSUninstalled(), true);
      const res = mod.installVibeTierAgents(proj, { cheap: { oc: 'x/c' }, medium: { oc: 'x/m' }, brain: { oc: 'x/b' } }, 'cheap', { includeGlobalHomes: false });
      assert.equal(res.changed.length, 0, 'must not write configs while uninstalled');
      const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
      assert.ok(!written.agent, 'config must not gain vibe agents while uninstalled');
    } finally {
      process.env.VIBEOS_UNINSTALLED_MARKER_DIR = prevDir;
    }
  });

  it('clearVibeOSUninstalledMarker re-enables registration', () => {
    const markerDir = withMarkerDir(mkdtempSync(join(tmpdir(), 'vibe-marker-')));
    writeFileSync(join(markerDir, mod.VIBEOS_UNINSTALLED_MARKER), 'uninstalled');
    try {
      assert.equal(mod.isVibeOSUninstalled(), true);
      mod.clearVibeOSUninstalledMarker();
      assert.equal(mod.isVibeOSUninstalled(), false);
    } finally {
      process.env.VIBEOS_UNINSTALLED_MARKER_DIR = prevDir;
    }
  });
});

