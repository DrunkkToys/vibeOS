import { describe, it, expect } from 'vitest';
import * as mod from '../templates';

describe('templates', () => {
  it('exposes the preset library and defaults', () => {
    expect(mod.DEFAULT_TEMPLATE).toBe('save');
    expect(mod.TEMPLATES.save.tier_bias).toBe('cheap');
    expect(mod.TEMPLATES.quality.tier_bias).toBe('brain');
    expect(mod.TEMPLATE_LIBRARY.some((tpl) => tpl.id === 'save')).toBe(true);
  });

  it('normalizes custom templates with trimmed bodies and stable signatures', () => {
    const template = mod.normalizeSessionTemplate({
      label: '  Session TDD  ',
      body: '  Write real assertions.  ',
      base_template_id: 'quality',
      revision: 3,
    }, 'save');

    expect(template?.label).toBe('Session TDD');
    expect(template?.body).toBe('Write real assertions.');
    expect(template?.source).toBe('custom');
    expect(template?.base_template_id).toBe('quality');
    expect(template?.signature).toContain(':3:');
  });

  it('resolves preset templates and keeps their directive text', () => {
    const template = mod.normalizeSessionTemplate({ id: 'quality', source: 'preset' }, 'save');
    const resolved = mod.resolveSessionTemplateDefinition(template);

    expect(resolved.id).toBe('quality');
    expect(resolved.source).toBe('preset');
    expect(resolved.body).toBe(mod.TEMPLATES.quality.directive);
  });

  it('detects signal types with real inputs', () => {
    expect(mod.detectSecuritySignal('possible token leak')).toBe(true);
    expect(mod.detectSecuritySignal('general planning note')).toBe(false);
    expect(mod.detectBudgetSignal(39)).toBe(true);
    expect(mod.detectBudgetSignal(40)).toBe(false);
    expect(mod.resolveTemplate('save', 0.9, 'please secure the token', 90, 'REFINING')).toBe('security');
  });
});
