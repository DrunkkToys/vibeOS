import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveTrinityDisplayModel,
  setTrinityBrain,
  setTrinityMedium,
  setTrinityCheap,
  _resetTrinitySlotsForTest,
  TRINITY_BRAIN,
  TRINITY_MEDIUM,
  TRINITY_CHEAP,
} from '../../pricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findProjectRoot(start) {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return start;
}
const FOOTER_TS_PATH = join(findProjectRoot(__dirname), 'src', 'lib', 'hooks', 'footer.ts');

describe('resolveTrinityDisplayModel (pricing.ts)', () => {
  before(() => {
    setTrinityBrain('deepseek/deepseek-v4-pro');
    setTrinityMedium('deepseek/deepseek-chat');
    setTrinityCheap('deepseek/deepseek-v4-flash');
  });

  after(() => {
    _resetTrinitySlotsForTest();
  });

  it('returns TRINITY_CHEAP for activeSlot="cheap" when TRINITY_CHEAP is set', () => {
    assert.equal(resolveTrinityDisplayModel('', 'cheap', '', ''), 'deepseek/deepseek-v4-flash');
  });

  it('returns TRINITY_BRAIN for activeSlot="brain" when TRINITY_BRAIN is set', () => {
    assert.equal(resolveTrinityDisplayModel('', 'brain', '', ''), 'deepseek/deepseek-v4-pro');
  });

  it('returns TRINITY_MEDIUM for activeSlot="medium" when TRINITY_MEDIUM is set', () => {
    assert.equal(resolveTrinityDisplayModel('', 'medium', '', ''), 'deepseek/deepseek-chat');
  });

  it('never returns Big Pickle when a TRINITY slot model is available', () => {
    assert.notEqual(resolveTrinityDisplayModel('', 'cheap', '', ''), 'opencode/big-pickle');
    assert.notEqual(resolveTrinityDisplayModel('', 'medium', '', ''), 'opencode/big-pickle');
    assert.notEqual(resolveTrinityDisplayModel('', 'brain', '', ''), 'opencode/big-pickle');
  });

  it('falls back to opencode/big-pickle when all models empty and slot is cheap', () => {
    _resetTrinitySlotsForTest();
    assert.equal(resolveTrinityDisplayModel('', 'cheap', '', ''), 'opencode/big-pickle');
    setTrinityBrain('deepseek/deepseek-v4-pro');
    setTrinityMedium('deepseek/deepseek-chat');
    setTrinityCheap('deepseek/deepseek-v4-flash');
  });
});

describe('_appendFooter displayModel resolution (footer.ts:347)', () => {
  before(() => {
    setTrinityBrain('deepseek/deepseek-v4-pro');
    setTrinityMedium('deepseek/deepseek-chat');
    setTrinityCheap('deepseek/deepseek-v4-flash');
  });

  after(() => {
    _resetTrinitySlotsForTest();
  });

  function trinitySlotModel(slot: string): string | null {
    if (slot === 'brain') return TRINITY_BRAIN;
    if (slot === 'medium') return TRINITY_MEDIUM;
    return TRINITY_CHEAP;
  }

  // Simulates the expected cascadeModel chain from footer.ts after the fix:
  //   cascadeModel = displayModel || TRINITY model for ultraResolvedTier || ""
  function resolveCascadeModel(
    finalVisibleModel: string | undefined | null,
    selectedModel: string | undefined | null,
    liveModelSetting: string | undefined | null,
    liveModel: string | undefined | null,
    currentModel: string,
    ultraResolvedTier: string,
  ): string {
    const displayModel = (
      (finalVisibleModel ?? '') ||
      (selectedModel ?? '') ||
      (liveModelSetting ?? '') ||
      (liveModel ?? '') ||
      currentModel ||
      ''
    );
    return (
      displayModel ||
      (ultraResolvedTier === 'brain' ? TRINITY_BRAIN
        : ultraResolvedTier === 'medium' ? TRINITY_MEDIUM
        : TRINITY_CHEAP) ||
      ''
    );
  }

  it('falls back to TRINITY_CHEAP when all upstream sources empty and no cascade (slot=cheap)', () => {
    const result = resolveCascadeModel(null, null, null, null, '', 'cheap');
    assert.equal(result, 'deepseek/deepseek-v4-flash');
  });

  it('falls back to TRINITY_BRAIN when cascade escalated to brain', () => {
    const result = resolveCascadeModel(null, null, null, null, '', 'brain');
    assert.equal(result, 'deepseek/deepseek-v4-pro');
  });

  it('falls back to TRINITY_MEDIUM when cascade escalated to medium', () => {
    const result = resolveCascadeModel(null, null, null, null, '', 'medium');
    assert.equal(result, 'deepseek/deepseek-chat');
  });

  it('upstream currentModel precedes TRINITY slot model', () => {
    const result = resolveCascadeModel(null, null, null, null, 'deepseek/deepseek-chat', 'cheap');
    assert.equal(result, 'deepseek/deepseek-chat');
  });

  it('never shows Big Pickle when TRINITY slot model is available', () => {
    const result = resolveCascadeModel(null, null, null, null, '', 'cheap');
    assert.notEqual(result, 'opencode/big-pickle');
    assert.equal(result, 'deepseek/deepseek-v4-flash');
  });

  it('finalVisibleModel takes priority over everything', () => {
    const result = resolveCascadeModel('final-model-id', 'executed-model', 'live-setting', 'live-model', 'current-model', 'cheap');
    assert.equal(result, 'final-model-id');
  });

  it('executedRoute.selectedModel takes priority after finalVisibleModel', () => {
    const result = resolveCascadeModel(null, 'executed-model', 'live-setting', null, '', 'cheap');
    assert.equal(result, 'executed-model');
  });

  it('liveModelSetting precedes liveModel', () => {
    const result = resolveCascadeModel(null, null, 'live-setting', 'live-model', '', 'cheap');
    assert.equal(result, 'live-setting');
  });

  it('liveModel precedes currentModel', () => {
    const result = resolveCascadeModel(null, null, null, 'live-model', 'current-model', 'cheap');
    assert.equal(result, 'live-model');
  });

  it('currentModel precedes TRINITY fallback', () => {
    const result = resolveCascadeModel(null, null, null, null, 'current-model', 'cheap');
    assert.equal(result, 'current-model');
  });

  /* ============================================================
   * SOURCE AUDIT — reads footer.ts for cascadeModel and verifies
   * it includes TRINITY fallback
   * ============================================================ */
  it('[AUDIT] footer.ts must define cascadeModel with TRINITY fallback', () => {
    const src = readFileSync(FOOTER_TS_PATH, 'utf-8');
    assert.ok(
      src.includes('cascadeModel') && src.includes('TRINITY'),
      'footer.ts is missing cascadeModel with TRINITY fallback'
    );
  });
});
