import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../pricing.js';

describe('pricing', () => {
  describe('classify', () => {
    it('returns budget for empty/null/undefined', () => {
      assert.equal(mod.classify(''), 'budget');
      assert.equal(mod.classify(null), 'budget');
      assert.equal(mod.classify(undefined), 'budget');
    });

    it('classifies deepseek/deepseek-v4-flash as mid', () => {
      assert.equal(mod.classify('deepseek/deepseek-v4-flash'), 'mid');
    });

    it('classifies opencode/mimo-v2.5 as mid', () => {
      assert.equal(mod.classify('opencode/mimo-v2.5'), 'mid');
    });

    it('classifies openai/o3 as high', () => {
      assert.equal(mod.classify('openai/o3'), 'high');
    });

    it('classifies anthropic/claude-opus-4 as high', () => {
      assert.equal(mod.classify('anthropic/claude-opus-4'), 'high');
    });
  });

  describe('normalizeModelId', () => {
    it('strips opencode/ prefix', () => {
      assert.equal(mod.normalizeModelId('opencode/big-pickle'), 'big-pickle');
    });

    it('strips openrouter/ prefix', () => {
      assert.equal(mod.normalizeModelId('openrouter/anthropic/claude-sonnet-4.6'), 'anthropic/claude-sonnet-4-6');
    });

    it('normalizes dots to hyphens', () => {
      assert.equal(mod.normalizeModelId('deepseek/deepseek-v3.2'), 'deepseek/deepseek-v3-2');
    });

    it('returns empty string for empty/null', () => {
      assert.equal(mod.normalizeModelId(''), '');
      assert.equal(mod.normalizeModelId(null), '');
    });
  });

  describe('roundUsd', () => {
    it('returns 0 for 0', () => {
      assert.equal(mod.roundUsd(0), 0);
    });

    it('rounds to 4 decimals with explicit precision', () => {
      assert.equal(mod.roundUsd(1.23456, 4), 1.2346);
    });

    it('handles negative numbers', () => {
      assert.equal(mod.roundUsd(-1.5), -1.5);
    });

    it('returns 0 for non-finite values', () => {
      assert.equal(mod.roundUsd(Infinity), 0);
      assert.equal(mod.roundUsd(NaN), 0);
    });
  });

  describe('formatUsd', () => {
    it('formats 0 as 0.00', () => {
      assert.equal(mod.formatUsd(0), '0.00');
    });

    it('formats 1.5 as 1.50', () => {
      assert.equal(mod.formatUsd(1.5), '1.50');
    });

    it('formats very small values with 4 decimals', () => {
      assert.equal(mod.formatUsd(0.0005), '0.0005');
    });

    it('formats negative values', () => {
      assert.equal(mod.formatUsd(-1.5), '-1.50');
    });
  });

  describe('shortModelName', () => {
    it('returns last segment after slash', () => {
      assert.equal(mod.shortModelName('opencode/big-pickle'), 'big-pickle');
      assert.equal(mod.shortModelName('deepseek/deepseek-v4-flash'), 'deepseek-v4-flash');
    });

    it('returns unknown for empty input', () => {
      assert.equal(mod.shortModelName(''), 'unknown');
    });

    it('returns full string when no slash', () => {
      assert.equal(mod.shortModelName('big-pickle'), 'big-pickle');
    });
  });

  describe('modelDisplayName', () => {
    it('formats display name for opencode/big-pickle', () => {
      assert.equal(mod.modelDisplayName('opencode/big-pickle'), 'Big Pickle');
    });

    it('strips common prefixes', () => {
      const result = mod.modelDisplayName('deepseek/deepseek-v4-flash');
      assert.equal(result, 'V4 Flash');
    });

    it('appends Free for -free models', () => {
      assert.equal(mod.modelDisplayName('opencode/big-pickle-free'), 'Big Pickle Free');
    });
  });

  describe('modelToSlotLabel', () => {
    it('returns brain label for high-tier model', () => {
      assert.equal(mod.modelToSlotLabel('openai/o3'), '[🧠 High]');
    });

    it('returns mid label for mid-tier model', () => {
      const label = mod.modelToSlotLabel('deepseek/deepseek-v4-flash');
      assert.match(label, /\[◐ Mid\]/);
    });

    it('returns cheap label for budget model', () => {
      assert.equal(mod.modelToSlotLabel('unknown-unknown'), '[⚡ Budget]');
    });

    it('uses explicit tier when provided', () => {
      assert.equal(mod.modelToSlotLabel('any-model', 'high'), '[🧠 High]');
    });
  });

  describe('getModelProvider', () => {
    it('extracts provider from model ID', () => {
      assert.equal(mod.getModelProvider('deepseek/deepseek-v4-flash'), 'deepseek');
      assert.equal(mod.getModelProvider('opencode/big-pickle'), 'opencode');
    });

    it('returns empty string for no provider', () => {
      assert.equal(mod.getModelProvider(''), '');
      assert.equal(mod.getModelProvider('bare-model'), '');
    });
  });

  describe('formatProviderName', () => {
    it('capitalizes known providers', () => {
      assert.equal(mod.formatProviderName('openai'), 'OpenAI');
      assert.equal(mod.formatProviderName('anthropic'), 'Anthropic');
      assert.equal(mod.formatProviderName('google'), 'Google');
      assert.equal(mod.formatProviderName('openrouter'), 'OpenRouter');
      assert.equal(mod.formatProviderName('opencode-go'), 'OpenCode Go');
    });

    it('capitalizes first letter for unknown providers', () => {
      assert.equal(mod.formatProviderName('deepseek'), 'Deepseek');
    });

    it('returns Unknown for empty', () => {
      assert.equal(mod.formatProviderName(''), 'Unknown');
    });
  });

  describe('formatQualityName', () => {
    it('maps brain/high to Brain', () => {
      assert.equal(mod.formatQualityName('brain'), 'Brain');
      assert.equal(mod.formatQualityName('high'), 'Brain');
    });

    it('maps medium/mid to Medium', () => {
      assert.equal(mod.formatQualityName('medium'), 'Medium');
      assert.equal(mod.formatQualityName('mid'), 'Medium');
    });

    it('maps cheap/budget to Cheap', () => {
      assert.equal(mod.formatQualityName('cheap'), 'Cheap');
      assert.equal(mod.formatQualityName('budget'), 'Cheap');
    });

    it('maps free to Free', () => {
      assert.equal(mod.formatQualityName('free'), 'Free');
    });
  });

  describe('resolveEffectiveTier', () => {
    it('returns classify result for empty slot', () => {
      assert.equal(mod.resolveEffectiveTier('deepseek/deepseek-v4-flash', ''), 'mid');
    });

    it('promotes to high when brain slot is active', () => {
      assert.equal(mod.resolveEffectiveTier('deepseek/deepseek-v4-flash', 'brain'), 'high');
    });

    it('returns high for already-high tier model in brain slot', () => {
      assert.equal(mod.resolveEffectiveTier('openai/o3', 'brain'), 'high');
    });

    it('returns classify result for non-brain slots', () => {
      assert.equal(mod.resolveEffectiveTier('deepseek/deepseek-v4-flash', 'cheap'), 'mid');
    });
  });

  describe('isModelFree', () => {
    it('returns true for known free models', () => {
      assert.equal(mod.isModelFree('opencode/big-pickle'), true);
      assert.equal(mod.isModelFree('opencode/big-pickle-free'), true);
    });

    it('returns true for -free suffixed models', () => {
      assert.equal(mod.isModelFree('opencode/nemotron-3-ultra-free'), true);
    });

    it('returns false for paid models', () => {
      assert.equal(mod.isModelFree('deepseek/deepseek-v4-flash'), false);
      assert.equal(mod.isModelFree('openai/o3'), false);
    });

    it('returns false for non-string input', () => {
      assert.equal(mod.isModelFree(null), false);
      assert.equal(mod.isModelFree(undefined), false);
      assert.equal(mod.isModelFree(''), false);
    });
  });

  describe('isDocsTarget', () => {
    it('matches docs URLs', () => {
      assert.equal(mod.isDocsTarget('https://docs.python.org/3/library/'), true);
      assert.equal(mod.isDocsTarget('https://developer.mozilla.org/en-US/'), true);
      assert.equal(mod.isDocsTarget('https://pkg.go.dev/fmt'), true);
    });

    it('returns false for non-docs URLs', () => {
      assert.equal(mod.isDocsTarget('https://example.com'), false);
    });

    it('returns false for non-string input', () => {
      assert.equal(mod.isDocsTarget(123), false);
      assert.equal(mod.isDocsTarget(null), false);
    });
  });

  describe('trendDisplay', () => {
    it('formats up trend', () => {
      assert.equal(mod.trendDisplay('up'), '↑ up');
    });

    it('formats down trend', () => {
      assert.equal(mod.trendDisplay('down'), '↓ down');
    });

    it('defaults to stable for unknown values', () => {
      assert.equal(mod.trendDisplay('sideways'), '→ stable');
    });

    it('defaults to stable for empty', () => {
      assert.equal(mod.trendDisplay(''), '→ stable');
    });
  });

  describe('PLACEHOLDER_RE', () => {
    it('is a RegExp', () => {
      assert.ok(mod.PLACEHOLDER_RE instanceof RegExp);
    });

    it('matches provider/some-model patterns', () => {
      assert.ok(mod.PLACEHOLDER_RE.test('deepseek/some-model'));
    });

    it('does not match normal model IDs', () => {
      assert.equal(mod.PLACEHOLDER_RE.test('deepseek/deepseek-v4-flash'), false);
    });

    it('does not match bare names', () => {
      assert.equal(mod.PLACEHOLDER_RE.test('big-pickle'), false);
    });
  });

  describe('buildDeterministicTrinity', () => {
    it('returns null for empty input', () => {
      assert.equal(mod.buildDeterministicTrinity([]), null);
      assert.equal(mod.buildDeterministicTrinity(null), null);
      assert.equal(mod.buildDeterministicTrinity(undefined), null);
    });

    it('returns null for input with no valid models', () => {
      assert.equal(mod.buildDeterministicTrinity([{ noId: true }]), null);
    });

    it('returns object with brain/medium/cheap for valid model list', () => {
      const models = [
        { id: 'deepseek/deepseek-v4-pro', cost: 0.00057 },
        { id: 'deepseek/deepseek-v4-flash', cost: 0.000182 },
      ];
      const result = mod.buildDeterministicTrinity(models);
      assert.notEqual(result, null);
      assert.equal(typeof result, 'object');
      assert.ok('brain' in result && 'medium' in result && 'cheap' in result);
      assert.equal(result.provider, 'deepseek');
      assert.equal(typeof result.brain, 'string');
      assert.ok(result.brain.length > 0);
    });

    it('includes label_modes array', () => {
      const models = [{ id: 'deepseek/deepseek-v4-flash', cost: 0.000182 }];
      const result = mod.buildDeterministicTrinity(models);
      assert.ok(Array.isArray(result.label_modes));
    });
  });

  describe('detectContext7', () => {
    it('is a function', () => {
      assert.equal(typeof mod.detectContext7, 'function');
    });

    it('returns true when env var is set', () => {
      const prev = process.env.CLAUDE_CONTEXT7_AVAILABLE;
      process.env.CLAUDE_CONTEXT7_AVAILABLE = '1';
      assert.equal(mod.detectContext7([]), true);
      if (prev === undefined) {
        delete process.env.CLAUDE_CONTEXT7_AVAILABLE;
      } else {
        process.env.CLAUDE_CONTEXT7_AVAILABLE = prev;
      }
    });

    it('returns false for empty file list', () => {
      const prev = process.env.CLAUDE_CONTEXT7_AVAILABLE;
      delete process.env.CLAUDE_CONTEXT7_AVAILABLE;
      const result = mod.detectContext7([]);
      assert.equal(result, false);
      if (prev !== undefined) {
        process.env.CLAUDE_CONTEXT7_AVAILABLE = prev;
      }
    });
  });
});
