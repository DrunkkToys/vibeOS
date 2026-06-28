import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../templates.js';

describe('templates', () => {
  beforeEach(() => {
    mod.resetSessionPolicyStateForTest?.();
  });

  it('exposes the preset library and defaults', () => {
    assert.equal(mod.DEFAULT_TEMPLATE, 'save');
    assert.equal(mod.TEMPLATES.save.tier_bias, 'cheap');
    assert.equal(mod.TEMPLATES.quality.tier_bias, 'brain');
    assert.equal(mod.TEMPLATE_LIBRARY.some((tpl) => tpl.id === 'save'), true);
  });

  it('normalizes custom templates with trimmed bodies and stable signatures', () => {
    const template = mod.normalizeSessionTemplate({
      label: '  Session TDD  ',
      body: '  Write real assertions.  ',
      base_template_id: 'quality',
      revision: 3,
    }, 'save');

    assert.equal(template?.label, 'Session TDD');
    assert.equal(template?.body, 'Write real assertions.');
    // source is "preset" unless raw.source === "custom" is passed explicitly,
    // even when base_template_id resolves to a known preset like "quality".
    assert.equal(template?.source, 'preset');
    assert.equal(template?.base_template_id, 'quality');
    assert.ok(template?.signature.includes(':3:'));
  });

  it('resolves preset templates and keeps their directive text', () => {
    const template = mod.normalizeSessionTemplate({ id: 'quality', source: 'preset' }, 'save');
    const resolved = mod.resolveSessionTemplateDefinition(template);

    assert.equal(resolved.id, 'quality');
    assert.equal(resolved.source, 'preset');
    assert.equal(resolved.body, mod.TEMPLATES.quality.directive);
  });

  it('detects signal types with real inputs', () => {
    assert.equal(mod.detectSecuritySignal('possible token leak'), true);
    assert.equal(mod.detectSecuritySignal('general planning note'), false);
    assert.equal(mod.detectBudgetSignal(39), true);
    assert.equal(mod.detectBudgetSignal(40), false);
    // SEC_KEYWORDS only matches the literal phrase "token leak", not "secure"/"token"
    // individually, so this phrasing doesn't trip the security branch.
    assert.equal(mod.resolveTemplate('save', 0.9, 'please secure the token', 90, 'REFINING'), 'quality');
  });
});
