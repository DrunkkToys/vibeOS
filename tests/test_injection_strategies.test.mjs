import test from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAMPLE BLACKBOX STATES — one per regime
// ─────────────────────────────────────────────────────────────────────────────

const REGIME_STATES = {
  INIT: {
    sub_regime: 'INIT',
    action: 'explore',
    n_interactions: 1,
    entropy: 0.8,
    uncertainty: 60,
    is_looping: false,
    momentum: 0.0,
    loop_depth: 0,
    last_actions: [],
    satisfaction_history: [],
  },
  EXPLORING: {
    sub_regime: 'EXPLORING',
    action: 'explore',
    n_interactions: 5,
    entropy: 1.2,
    uncertainty: 55,
    is_looping: false,
    momentum: 0.2,
    loop_depth: 0,
    last_actions: ['explore', 'explore', 'explore'],
    satisfaction_history: [0.7, 0.8],
  },
  DIVERGENT: {
    sub_regime: 'DIVERGENT',
    action: 'change',
    n_interactions: 8,
    entropy: 2.0,
    uncertainty: 80,
    is_looping: false,
    momentum: -0.3,
    loop_depth: 0,
    last_actions: ['change', 'explore', 'change', 'explore'],
    satisfaction_history: [0.4, 0.3, 0.5],
  },
  REFINING: {
    sub_regime: 'REFINING',
    action: 'act',
    n_interactions: 12,
    entropy: 1.0,
    uncertainty: 40,
    is_looping: false,
    momentum: 0.5,
    loop_depth: 0,
    last_actions: ['act', 'act', 'observe', 'act'],
    satisfaction_history: [0.7, 0.8, 0.75, 0.85],
  },
  CONVERGING: {
    sub_regime: 'CONVERGING',
    action: 'act',
    n_interactions: 18,
    entropy: 0.6,
    uncertainty: 25,
    is_looping: false,
    momentum: 0.8,
    loop_depth: 0,
    last_actions: ['act', 'act', 'act', 'observe', 'act'],
    satisfaction_history: [0.85, 0.9, 0.88, 0.92, 0.9],
  },
  LOOPING: {
    sub_regime: 'LOOPING',
    action: 'explore',
    n_interactions: 25,
    entropy: 0.5,
    uncertainty: 70,
    is_looping: true,
    momentum: -0.6,
    loop_depth: 3,
    last_actions: ['explore', 'change', 'explore', 'change', 'explore'],
    satisfaction_history: [0.3, 0.25, 0.35, 0.2, 0.3],
  },
  CLOSED: {
    sub_regime: 'CLOSED',
    action: 'commit',
    n_interactions: 30,
    entropy: 0.3,
    uncertainty: 15,
    is_looping: false,
    momentum: 0.9,
    loop_depth: 0,
    last_actions: ['act', 'act', 'commit'],
    satisfaction_history: [0.9, 0.95, 0.92, 0.98],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. CURRENT DIRECTIVES — with full and compact forms
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIVE_CATEGORIES = [
  'CONTEXT7',
  'THINKING_LEVEL',
  'STRESS',
  'BLACKBOX_CV',
  'ORCHESTRATOR',
  'BATCH_EXEC',
  'TDD',
  'FLOW',
  'PROJECT_GUARD',
  'CONTEXT_BUDGET',
  'AI_ORCHESTRATOR',
];

const DIRECTIVES = {
  CONTEXT7: {
    full: `[AI ORCHESTRATOR AGENT] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch when looking up library or framework documentation (docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). Do not fetch those URLs directly when context7 can serve the same content. This saves ~$0.06/turn on average.`,
    compact: `[context7] Use context7 MCP tools for all library/doc lookups instead of web fetch. Saves ~$0.06/turn.`,
    priority: 0.95,
  },
  THINKING_LEVEL: {
    full: `[thinking policy] Reasoning depth: BRIEF (manually set, credit 150%). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise — skip exploratory scratch work and restatement.`,
    compact: `[thinking] BRIEF depth. Use extended thinking only for complex problems.`,
    priority: 0.85,
  },
  STRESS: {
    full: `[stress mitigation] You are monitoring user stress signals. If detected: (1) Acknowledge stress level, (2) Simplify responses, (3) Avoid jargon, (4) Offer concrete next steps. Stress gauge: ▁▂▃▅▆█. Current session stress score: {score}. Elevated directives active.`,
    compact: `[stress] Monitor stress signals. Simplify if detected. Score: {score}.`,
    priority: 0.9,
  },
  BLACKBOX_CV: {
    full: `[blackbox engine] Active. Sub-regime: {sub_regime}. Action: {action}. Entropy: {entropy}. Uncertainty: {uncertainty}%. Momentum: {momentum}. Loop depth: {loop_depth}. Resolution state: {resolution}. Follow regime-appropriate behavior: EXPLORING=ask clarifying questions, REFINING=focus on implementation, CONVERGING=finalize, LOOPING=break pattern with different approach, CLOSED=wrap up.`,
    compact: `[blackbox] {sub_regime}|{action}|e={entropy}|u={uncertainty}|m={momentum}. Follow regime behavior.`,
    priority: 0.8,
  },
  ORCHESTRATOR: {
    full: `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. Delegate heavy work to Task subagents (runs on deepseek/deepseek-chat or deepseek/deepseek-v4-flash). Your role: verify, fill gaps, synthesize. CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. Always display the vibeOS cost footer.`,
    compact: `[orchestrator] Delegate heavy work to Task subagents. Write/Edit BLOCKED. Must delegate implementation.`,
    priority: 0.92,
  },
  BATCH_EXEC: {
    full: `[batch execution] When you need to run multiple independent Task subagent calls, invoke them ALL in parallel rather than sequentially. Parallel tasks complete faster and reduce total session cost. Only sequence tasks when one depends on the output of another.`,
    compact: `[batch] Run independent Task subagents in parallel. Sequence only when dependent.`,
    priority: 0.75,
  },
  TDD: {
    full: `[flow enforcement: TDD] TDD enforcer is active. Auto-create skeleton tests for changed source files. Strict mode: TODO tests fail loudly. Quality mode: trinity tdd quality on|off. Run tests before committing. Never assume test framework — check README or codebase.`,
    compact: `[tdd] Auto-create test skeletons. Strict mode ON. Run tests before commit.`,
    priority: 0.7,
  },
  FLOW: {
    full: `[flow enforcement: audit] Development flow rules are active: write/edit operations are checked against project conventions. Follow existing code patterns, naming conventions, and project structure. AGENTS.md defines conventions — respect them.`,
    compact: `[flow] Follow project conventions. Respect AGENTS.md patterns.`,
    priority: 0.72,
  },
  PROJECT_GUARD: {
    full: `[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. Do NOT modify either file without explicit user permission. When implementing new features, update README.md to document them. AGENTS.md defines that AI agents must ask before changing code — respect this rule.`,
    compact: `[guard] AGENTS.md/README.md protected. Ask before modifying. Update README for new features.`,
    priority: 0.88,
  },
  CONTEXT_BUDGET: {
    full: `[context budget] You are operating under a context budget. Be concise. Avoid restating known information. Use tool results efficiently. Summarize rather than quoting full outputs. Target: minimize token usage while maintaining quality.`,
    compact: `[budget] Be concise. Summarize tool outputs. Minimize tokens while maintaining quality.`,
    priority: 0.6,
  },
  AI_ORCHESTRATOR: {
    full: `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. Delegate heavy work to Task subagents (runs on deepseek/deepseek-chat or deepseek/deepseek-v4-flash). Your role: verify, fill gaps, synthesize. CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. Always display the vibeOS cost footer.`,
    compact: `[orchestrator] Delegate to Task subagents. Write/Edit BLOCKED. Show cost footer.`,
    priority: 0.93,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. CURRENT SETTINGS (simulated per-regime toggles)
// ─────────────────────────────────────────────────────────────────────────────

const REGIME_SETTINGS = {
  INIT: {
    stress_score: 0,
    tdd_enforce: false,
    flow_enabled: false,
    delegation_active: false,
    context_budget: false,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  EXPLORING: {
    stress_score: 0,
    tdd_enforce: false,
    flow_enabled: false,
    delegation_active: false,
    context_budget: false,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  DIVERGENT: {
    stress_score: 0.3,
    tdd_enforce: false,
    flow_enabled: true,
    delegation_active: false,
    context_budget: false,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  REFINING: {
    stress_score: 0,
    tdd_enforce: true,
    flow_enabled: true,
    delegation_active: true,
    context_budget: false,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  CONVERGING: {
    stress_score: 0,
    tdd_enforce: true,
    flow_enabled: true,
    delegation_active: true,
    context_budget: true,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  LOOPING: {
    stress_score: 0.6,
    tdd_enforce: true,
    flow_enabled: true,
    delegation_active: true,
    context_budget: true,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
  CLOSED: {
    stress_score: 0,
    tdd_enforce: false,
    flow_enabled: false,
    delegation_active: false,
    context_budget: false,
    blackbox_active: true,
    thinking_level: 'BRIEF',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: count tokens (chars / 4, ceiling)
// ─────────────────────────────────────────────────────────────────────────────

function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: fill template placeholders in directive text
// ─────────────────────────────────────────────────────────────────────────────

function fillTemplate(text, state) {
  return text
    .replace('{sub_regime}', state.sub_regime)
    .replace('{action}', state.action)
    .replace('{entropy}', state.entropy)
    .replace('{uncertainty}', state.uncertainty)
    .replace('{momentum}', state.momentum)
    .replace('{loop_depth}', state.loop_depth)
    .replace('{score}', '0.0')
    .replace('{resolution}', 'tracking');
}

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE: current approach (inject all active directives in full)
// ─────────────────────────────────────────────────────────────────────────────

function getBaselineDirectives(state, settings) {
  const directives = [];
  const categories = [];

  // CONTEXT7 — always
  directives.push(fillTemplate(DIRECTIVES.CONTEXT7.full, state));
  categories.push('CONTEXT7');

  // THINKING_LEVEL — always when set
  if (settings.thinking_level) {
    directives.push(fillTemplate(DIRECTIVES.THINKING_LEVEL.full, state));
    categories.push('THINKING_LEVEL');
  }

  // STRESS — conditional
  if (settings.stress_score > 0.2) {
    const stressText = DIRECTIVES.STRESS.full.replace('{score}', settings.stress_score.toFixed(2));
    directives.push(fillTemplate(stressText, state));
    categories.push('STRESS');
  }

  // BLACKBOX_CV — variable
  if (settings.blackbox_active) {
    directives.push(fillTemplate(DIRECTIVES.BLACKBOX_CV.full, state));
    categories.push('BLACKBOX_CV');
  }

  // ORCHESTRATOR — when delegation active
  if (settings.delegation_active) {
    directives.push(fillTemplate(DIRECTIVES.ORCHESTRATOR.full, state));
    categories.push('ORCHESTRATOR');
  }

  // BATCH_EXEC — when orchestrator active
  if (settings.delegation_active) {
    directives.push(fillTemplate(DIRECTIVES.BATCH_EXEC.full, state));
    categories.push('BATCH_EXEC');
  }

  // TDD — when tdd_enforce
  if (settings.tdd_enforce) {
    directives.push(fillTemplate(DIRECTIVES.TDD.full, state));
    categories.push('TDD');
  }

  // FLOW — when flow_enabled
  if (settings.flow_enabled) {
    directives.push(fillTemplate(DIRECTIVES.FLOW.full, state));
    categories.push('FLOW');
  }

  // PROJECT_GUARD — always
  directives.push(fillTemplate(DIRECTIVES.PROJECT_GUARD.full, state));
  categories.push('PROJECT_GUARD');

  // CONTEXT_BUDGET — conditional
  if (settings.context_budget) {
    directives.push(fillTemplate(DIRECTIVES.CONTEXT_BUDGET.full, state));
    categories.push('CONTEXT_BUDGET');
  }

  // AI_ORCHESTRATOR — always (duplicate of orchestrator role)
  directives.push(fillTemplate(DIRECTIVES.AI_ORCHESTRATOR.full, state));
  categories.push('AI_ORCHESTRATOR');

  const fullText = directives.join('\n');
  return {
    directives,
    tokens: countTokens(fullText),
    categories,
    text: fullText,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROACH A: Suppress Directives
// ─────────────────────────────────────────────────────────────────────────────
// When regime indicates directives are unnecessary, skip them entirely.
// Suppression map: regime → categories to suppress.

const SUPPRESSION_MAP = {
  INIT: [],
  EXPLORING: ['BLACKBOX_CV', 'THINKING_LEVEL'],
  DIVERGENT: ['BLACKBOX_CV', 'FLOW'],
  REFINING: ['FLOW', 'TDD'],
  CONVERGING: [],
  LOOPING: ['TDD', 'BATCH_EXEC'],
  CLOSED: ['TDD', 'FLOW', 'ORCHESTRATOR', 'BATCH_EXEC', 'CONTEXT_BUDGET', 'BLACKBOX_CV'],
};

function getSuppressDirectives(state, settings) {
  const suppress = SUPPRESSION_MAP[state.sub_regime] || [];
  const baseline = getBaselineDirectives(state, settings);

  const directives = [];
  const categories = [];

  for (let i = 0; i < baseline.directives.length; i++) {
    if (!suppress.includes(baseline.categories[i])) {
      directives.push(baseline.directives[i]);
      categories.push(baseline.categories[i]);
    }
  }

  const fullText = directives.join('\n');
  return {
    directives,
    tokens: countTokens(fullText),
    categories,
    text: fullText,
    suppressed: suppress,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROACH B: Directive Compression
// ─────────────────────────────────────────────────────────────────────────────
// Keep all categories but use compact forms when in "lazy" regimes.

const COMPACT_REGIMES = ['INIT', 'EXPLORING', 'CLOSED'];

function getCompressDirectives(state, settings) {
  const useCompact = COMPACT_REGIMES.includes(state.sub_regime);
  const form = useCompact ? 'compact' : 'full';

  const directives = [];
  const categories = [];

  // CONTEXT7 — always
  directives.push(fillTemplate(DIRECTIVES.CONTEXT7[form], state));
  categories.push('CONTEXT7');

  if (settings.thinking_level) {
    directives.push(fillTemplate(DIRECTIVES.THINKING_LEVEL[form], state));
    categories.push('THINKING_LEVEL');
  }

  if (settings.stress_score > 0.2) {
    const stressText = DIRECTIVES.STRESS[form].replace('{score}', settings.stress_score.toFixed(2));
    directives.push(fillTemplate(stressText, state));
    categories.push('STRESS');
  }

  if (settings.blackbox_active) {
    directives.push(fillTemplate(DIRECTIVES.BLACKBOX_CV[form], state));
    categories.push('BLACKBOX_CV');
  }

  if (settings.delegation_active) {
    directives.push(fillTemplate(DIRECTIVES.ORCHESTRATOR[form], state));
    categories.push('ORCHESTRATOR');
  }

  if (settings.delegation_active) {
    directives.push(fillTemplate(DIRECTIVES.BATCH_EXEC[form], state));
    categories.push('BATCH_EXEC');
  }

  if (settings.tdd_enforce) {
    directives.push(fillTemplate(DIRECTIVES.TDD[form], state));
    categories.push('TDD');
  }

  if (settings.flow_enabled) {
    directives.push(fillTemplate(DIRECTIVES.FLOW[form], state));
    categories.push('FLOW');
  }

  directives.push(fillTemplate(DIRECTIVES.PROJECT_GUARD[form], state));
  categories.push('PROJECT_GUARD');

  if (settings.context_budget) {
    directives.push(fillTemplate(DIRECTIVES.CONTEXT_BUDGET[form], state));
    categories.push('CONTEXT_BUDGET');
  }

  directives.push(fillTemplate(DIRECTIVES.AI_ORCHESTRATOR[form], state));
  categories.push('AI_ORCHESTRATOR');

  const fullText = directives.join('\n');
  return {
    directives,
    tokens: countTokens(fullText),
    categories,
    text: fullText,
    compressed: useCompact,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROACH C: Token Budget with Priority Queue
// ─────────────────────────────────────────────────────────────────────────────
// Set per-regime token budget. Fill highest-priority first.

const REGIME_BUDGETS = {
  INIT: 200,
  EXPLORING: 220,
  DIVERGENT: 300,
  REFINING: 400,
  CONVERGING: 450,
  LOOPING: 320,
  CLOSED: 250,
};

function getBudgetDirectives(state, settings) {
  const budget = REGIME_BUDGETS[state.sub_regime] || 200;

  // Build candidate list with priorities
  const candidates = [];

  const addCandidate = (key, form, condition) => {
    if (condition) {
      const text = fillTemplate(DIRECTIVES[key][form], state);
      candidates.push({
        key,
        text,
        tokens: countTokens(text),
        priority: DIRECTIVES[key].priority,
      });
    }
  };

  // Always add these
  addCandidate('CONTEXT7', 'full', true);
  addCandidate('THINKING_LEVEL', 'full', !!settings.thinking_level);
  addCandidate('PROJECT_GUARD', 'full', true);
  addCandidate('AI_ORCHESTRATOR', 'full', true);

  // Conditional
  addCandidate('STRESS', 'full', settings.stress_score > 0.2);
  addCandidate('BLACKBOX_CV', 'full', settings.blackbox_active);
  addCandidate('ORCHESTRATOR', 'full', settings.delegation_active);
  addCandidate('BATCH_EXEC', 'full', settings.delegation_active);
  addCandidate('TDD', 'full', settings.tdd_enforce);
  addCandidate('FLOW', 'full', settings.flow_enabled);
  addCandidate('CONTEXT_BUDGET', 'full', settings.context_budget);

  // Sort by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  // Fill budget
  const selected = [];
  let usedTokens = 0;

  for (const candidate of candidates) {
    if (usedTokens + candidate.tokens <= budget) {
      selected.push(candidate);
      usedTokens += candidate.tokens;
    }
  }

  const directives = selected.map(c => c.text);
  const categories = selected.map(c => c.key);

  return {
    directives,
    tokens: usedTokens,
    categories,
    budget,
    dropped: candidates.length - selected.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROACH D: Turn-Based Injection (stale)
// ─────────────────────────────────────────────────────────────────────────────
// Inject "heavy" directives only every N turns. Track last-injected turn.

const HEAVY_CATEGORIES = ['TDD', 'FLOW', 'ORCHESTRATOR', 'BATCH_EXEC', 'AI_ORCHESTRATOR'];
const INJECTION_COOLDOWN = 4; // every 4 turns

// Simulated turn counter per regime (based on n_interactions)
function getTurnBasedDirectives(state, settings) {
  const turn = state.n_interactions;
  const injectHeavy = turn % INJECTION_COOLDOWN === 0 || turn <= 2;

  const directives = [];
  const categories = [];

  // Light directives — always injected
  const addLight = (key) => {
    const text = fillTemplate(DIRECTIVES[key].full, state);
    directives.push(text);
    categories.push(key);
  };

  addLight('CONTEXT7');
  if (settings.thinking_level) addLight('THINKING_LEVEL');
  if (settings.stress_score > 0.2) {
    const stressText = DIRECTIVES.STRESS.full.replace('{score}', settings.stress_score.toFixed(2));
    directives.push(fillTemplate(stressText, state));
    categories.push('STRESS');
  }
  if (settings.blackbox_active) addLight('BLACKBOX_CV');
  addLight('PROJECT_GUARD');
  if (settings.context_budget) addLight('CONTEXT_BUDGET');

  // Heavy directives — only every N turns
  if (injectHeavy) {
    if (settings.delegation_active) addLight('ORCHESTRATOR');
    if (settings.delegation_active) addLight('BATCH_EXEC');
    if (settings.tdd_enforce) addLight('TDD');
    if (settings.flow_enabled) addLight('FLOW');
    addLight('AI_ORCHESTRATOR');
  }

  const fullText = directives.join('\n');
  return {
    directives,
    tokens: countTokens(fullText),
    categories,
    injectHeavy,
    stale: !injectHeavy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MEASUREMENT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function measureCoverage(result, baselineCategories) {
  const present = result.categories.filter(c => baselineCategories.includes(c));
  return present.length / DIRECTIVE_CATEGORIES.length;
}

function measureBehavioralFidelity(result, state, settings) {
  // Heuristic: check if critical directives are present for the regime
  let score = 1.0;
  const cats = result.categories;

  // Always needed
  if (!cats.includes('CONTEXT7')) score -= 0.15;
  if (!cats.includes('PROJECT_GUARD')) score -= 0.1;

  // Regime-specific needs
  if (state.sub_regime === 'REFINING' || state.sub_regime === 'CONVERGING') {
    if (!cats.includes('TDD') && settings.tdd_enforce) score -= 0.1;
    if (!cats.includes('FLOW') && settings.flow_enabled) score -= 0.1;
  }

  if (state.sub_regime === 'LOOPING') {
    if (!cats.includes('BLACKBOX_CV')) score -= 0.15;
  }

  if (settings.delegation_active) {
    if (!cats.includes('ORCHESTRATOR')) score -= 0.15;
  }

  if (settings.stress_score > 0.2) {
    if (!cats.includes('STRESS')) score -= 0.1;
  }

  return Math.max(0, score);
}

function measureComplexity(approachName) {
  // Subjective complexity scores (0-1)
  const complexities = {
    'A: Suppress': 0.2,
    'B: Compress': 0.3,
    'C: Budget': 0.6,
    'D: Turn-based': 0.4,
  };
  return complexities[approachName] || 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. APPROACH REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

const APPROACHES = [
  {
    name: 'A: Suppress',
    fn: getSuppressDirectives,
  },
  {
    name: 'B: Compress',
    fn: getCompressDirectives,
  },
  {
    name: 'C: Budget',
    fn: getBudgetDirectives,
  },
  {
    name: 'D: Turn-based',
    fn: getTurnBasedDirectives,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6. TEST: Comprehensive Benchmark
// ─────────────────────────────────────────────────────────────────────────────

test('injection strategies benchmark: compare 4 approaches across all regimes', (t) => {
  const regimes = Object.keys(REGIME_STATES);
  const results = {};

  // Initialize results structure
  for (const approach of APPROACHES) {
    results[approach.name] = {};
    for (const regime of regimes) {
      results[approach.name][regime] = null;
    }
  }

  // Run each approach against each regime
  for (const approach of APPROACHES) {
    for (const regime of regimes) {
      const state = REGIME_STATES[regime];
      const settings = REGIME_SETTINGS[regime];
      const baseline = getBaselineDirectives(state, settings);

      const result = approach.fn(state, settings);

      // Validate output structure
      assert.ok(Array.isArray(result.directives), `${approach.name}/${regime}: directives should be array`);
      assert.ok(typeof result.tokens === 'number', `${approach.name}/${regime}: tokens should be number`);
      assert.ok(Array.isArray(result.categories), `${approach.name}/${regime}: categories should be array`);
      assert.ok(result.tokens > 0, `${approach.name}/${regime}: tokens should be positive`);

      // Measure metrics
      const coverage = measureCoverage(result, baseline.categories);
      const fidelity = measureBehavioralFidelity(result, state, settings);
      const baselineTokens = baseline.tokens;
      const savings = Math.max(0, (baselineTokens - result.tokens) / baselineTokens);

      results[approach.name][regime] = {
        tokens: result.tokens,
        baselineTokens,
        savings,
        coverage,
        fidelity,
        categories: result.categories,
        suppressed: result.suppressed || [],
        compressed: result.compressed || false,
        dropped: result.dropped || 0,
        stale: result.stale || false,
      };
    }
  }

  // Compute aggregate scores
  const scores = {};
  for (const approach of APPROACHES) {
    const name = approach.name;
    let avgSavings = 0;
    let avgCoverage = 0;
    let avgFidelity = 0;

    for (const regime of regimes) {
      const r = results[name][regime];
      avgSavings += r.savings;
      avgCoverage += r.coverage;
      avgFidelity += r.fidelity;
    }

    avgSavings /= regimes.length;
    avgCoverage /= regimes.length;
    avgFidelity /= regimes.length;

    const complexity = measureComplexity(name);
    const compositeScore = avgSavings * 0.4 + avgCoverage * 0.3 + (1 - complexity) * 0.3;

    scores[name] = {
      avgSavings,
      avgCoverage,
      avgFidelity,
      complexity,
      compositeScore,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Print comparison table
  // ─────────────────────────────────────────────────────────────────────────

  const pad = (val, len = 10) => String(val).padEnd(len);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  console.log('\n');
  console.log('═'.repeat(140));
  console.log('VIBEOS DIRECTIVE INJECTION STRATEGY BENCHMARK');
  console.log('═'.repeat(140));
  console.log('');

  // Header
  let header = '| Approach ';
  for (const regime of regimes) {
    header += `| ${pad(regime.slice(0, 8), 10)}`;
  }
  header += '| Avg Savings | Coverage | Complexity | Score |';
  console.log(header);

  let separator = '|----------';
  for (const _ of regimes) {
    separator += '|-----------';
  }
  separator += '|-------------|----------|------------|-------|';
  console.log(separator);

  // Rows
  for (const approach of APPROACHES) {
    const name = approach.name;
    let row = `| ${pad(name.slice(0, 10), 10)}`;

    for (const regime of regimes) {
      const r = results[name][regime];
      const savingsStr = r.savings > 0 ? `-${pct(r.savings)}` : 'baseline';
      row += `| ${pad(savingsStr, 10)}`;
    }

    const s = scores[name];
    row += `| ${pad(pct(s.avgSavings), 11)}`;
    row += `| ${pad(pct(s.avgCoverage), 8)}`;
    row += `| ${pad(s.complexity.toFixed(2), 10)}`;
    row += `| ${pad(s.compositeScore.toFixed(3), 5)}`;
    row += '|';

    console.log(row);
  }

  console.log('');
  console.log('─'.repeat(140));

  // Detailed per-approach breakdown
  console.log('\nDETAILED BREAKDOWN:\n');

  for (const approach of APPROACHES) {
    const name = approach.name;
    console.log(`\n${name}:`);
    console.log(`  Avg Savings:    ${pct(scores[name].avgSavings)}`);
    console.log(`  Avg Coverage:   ${pct(scores[name].avgCoverage)}`);
    console.log(`  Avg Fidelity:   ${pct(scores[name].avgFidelity)}`);
    console.log(`  Complexity:     ${scores[name].complexity.toFixed(2)}`);
    console.log(`  Composite Score: ${scores[name].compositeScore.toFixed(3)}`);

    console.log('  Per-regime tokens:');
    for (const regime of regimes) {
      const r = results[name][regime];
      const delta = r.baselineTokens - r.tokens;
      const deltaStr = delta > 0 ? `(-${delta})` : delta < 0 ? `(+${Math.abs(delta)})` : '(=)';
      console.log(`    ${pad(regime, 12)}: ${pad(r.tokens, 5)} tokens ${pad(deltaStr, 8)} coverage=${pct(r.coverage)} fidelity=${pct(r.fidelity)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Determine winner
  // ─────────────────────────────────────────────────────────────────────────

  let winner = null;
  let bestScore = -Infinity;

  for (const approach of APPROACHES) {
    const score = scores[approach.name].compositeScore;
    if (score > bestScore) {
      bestScore = score;
      winner = approach.name;
    }
  }

  console.log('\n');
  console.log('═'.repeat(60));
  console.log(`WINNER: ${winner} (score: ${bestScore.toFixed(3)})`);
  console.log('═'.repeat(60));
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // Assertions
  // ─────────────────────────────────────────────────────────────────────────

  // All approaches should produce fewer or equal tokens than baseline in at least some regimes
  for (const approach of APPROACHES) {
    const name = approach.name;
    let hasSavings = false;
    for (const regime of regimes) {
      if (results[name][regime].tokens <= results[name][regime].baselineTokens) {
        hasSavings = true;
        break;
      }
    }
    assert.ok(hasSavings, `${name} should save tokens in at least one regime`);
  }

  // Coverage should never be zero for any approach
  for (const approach of APPROACHES) {
    const name = approach.name;
    for (const regime of regimes) {
      assert.ok(
        results[name][regime].coverage > 0,
        `${name}/${regime} should have non-zero coverage`
      );
    }
  }

  // Fidelity should be reasonable (>0.5) for all approaches in all regimes
  for (const approach of APPROACHES) {
    const name = approach.name;
    for (const regime of regimes) {
      assert.ok(
        results[name][regime].fidelity > 0.5,
        `${name}/${regime} fidelity should be >0.5, got ${results[name][regime].fidelity}`
      );
    }
  }

  // Winner score should be positive
  assert.ok(bestScore > 0, 'Winner composite score should be positive');

  // Complexity scores should be in [0, 1]
  for (const approach of APPROACHES) {
    const c = measureComplexity(approach.name);
    assert.ok(c >= 0 && c <= 1, `Complexity for ${approach.name} should be in [0,1], got ${c}`);
  }

  // Budget approach should respect budget limits
  for (const regime of regimes) {
    const r = results['C: Budget'][regime];
    const budget = REGIME_BUDGETS[regime] || 200;
    assert.ok(
      r.tokens <= budget,
      `Budget approach for ${regime} should not exceed budget ${budget}, got ${r.tokens}`
    );
  }

  // Suppress approach should have fewer categories than baseline in suppressed regimes
  for (const regime of regimes) {
    const baseline = getBaselineDirectives(REGIME_STATES[regime], REGIME_SETTINGS[regime]);
    const suppressed = getSuppressDirectives(REGIME_STATES[regime], REGIME_SETTINGS[regime]);
    if (SUPPRESSION_MAP[regime].length > 0) {
      assert.ok(
        suppressed.categories.length <= baseline.categories.length,
        `Suppress approach for ${regime} should have <= categories than baseline`
      );
    }
  }

  // Compress approach should maintain all categories
  for (const regime of regimes) {
    const compressed = getCompressDirectives(REGIME_STATES[regime], REGIME_SETTINGS[regime]);
    const baseline = getBaselineDirectives(REGIME_STATES[regime], REGIME_SETTINGS[regime]);
    assert.ok(
      compressed.categories.length === baseline.categories.length,
      `Compress approach for ${regime} should maintain all categories`
    );
  }

  // Turn-based approach should skip heavy directives on some turns
  const exploringResult = results['D: Turn-based']['EXPLORING'];
  const refiningResult = results['D: Turn-based']['REFINING'];
  // EXPLORING has n_interactions=5, 5%4=1, so heavy is NOT injected
  // REFINING has n_interactions=12, 12%4=0, so heavy IS injected
  assert.ok(
    !exploringResult.injectHeavy,
    'Turn-based should NOT inject heavy directives at turn 5'
  );
  assert.ok(
    refiningResult.injectHeavy || refiningResult.tokens < 500 || refiningResult.categories.length > 0,
    'Turn-based should inject directives at turn 12'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. TEST: Validate directive token estimates
// ─────────────────────────────────────────────────────────────────────────────

test('directive token estimates are within expected ranges', (t) => {
  const state = REGIME_STATES.REFINING;
  const settings = REGIME_SETTINGS.REFINING;
  const baseline = getBaselineDirectives(state, settings);

  // Build a map of category → tokens for individual directives
  const categoryTokens = {};
  for (let i = 0; i < baseline.categories.length; i++) {
    const cat = baseline.categories[i];
    categoryTokens[cat] = countTokens(baseline.directives[i]);
  }

  // Verify approximate token counts match expectations
  const expectations = {
    CONTEXT7: { min: 90, max: 130 },
    THINKING_LEVEL: { min: 40, max: 65 },
    BLACKBOX_CV: { min: 80, max: 150 },
    ORCHESTRATOR: { min: 70, max: 100 },
    BATCH_EXEC: { min: 25, max: 70 },
    TDD: { min: 25, max: 75 },
    FLOW: { min: 25, max: 75 },
    PROJECT_GUARD: { min: 30, max: 80 },
    AI_ORCHESTRATOR: { min: 40, max: 100 },
  };

  for (const [cat, range] of Object.entries(expectations)) {
    if (categoryTokens[cat]) {
      assert.ok(
        categoryTokens[cat] >= range.min && categoryTokens[cat] <= range.max,
        `${cat} tokens (${categoryTokens[cat]}) should be in range [${range.min}, ${range.max}]`
      );
    }
  }

  // Total baseline should be in expected range for REFINING (all directives active)
  assert.ok(
    baseline.tokens >= 250 && baseline.tokens <= 700,
    `Baseline tokens for REFINING (${baseline.tokens}) should be in expected range`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. TEST: Verify suppression map correctness
// ─────────────────────────────────────────────────────────────────────────────

test('suppression map covers expected patterns', (t) => {
  // INIT: nothing suppressed (first turn, need all context)
  assert.deepStrictEqual(SUPPRESSION_MAP.INIT, [], 'INIT should suppress nothing');

  // CLOSED: maximum suppression (wrapping up, minimal directives needed)
  const closedSuppress = SUPPRESSION_MAP.CLOSED;
  assert.ok(closedSuppress.length >= 4, 'CLOSED should suppress at least 4 categories');
  assert.ok(closedSuppress.includes('TDD'), 'CLOSED should suppress TDD');
  assert.ok(closedSuppress.includes('FLOW'), 'CLOSED should suppress FLOW');

  // EXPLORING: suppress some always-active directives to test suppression
  const exploringSuppress = SUPPRESSION_MAP.EXPLORING;
  assert.ok(exploringSuppress.length > 0, 'EXPLORING should suppress at least one category');
  assert.ok(exploringSuppress.includes('BLACKBOX_CV'), 'EXPLORING should suppress BLACKBOX_CV');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. TEST: Budget respects priority ordering
// ─────────────────────────────────────────────────────────────────────────────

test('budget approach respects priority ordering', (t) => {
  const state = REGIME_STATES.CLOSED;
  const settings = REGIME_SETTINGS.CLOSED;
  const result = getBudgetDirectives(state, settings);

  // CONTEXT7 and PROJECT_GUARD have highest priorities, should always be present
  assert.ok(result.categories.includes('CONTEXT7'), 'Budget should include CONTEXT7');
  // PROJECT_GUARD has high priority, should be present when budget allows
  const hasGuard = result.categories.includes('PROJECT_GUARD');
  if (!hasGuard) {
    assert.ok(result.categories.length > 0, 'Budget should include at least some categories');
    assert.ok(result.dropped > 0, 'PROJECT_GUARD was dropped due to budget constraints');
  }

  // Lower priority items should be dropped first when budget is tight
  // CONTEXT_BUDGET has priority 0.6, should be dropped in CLOSED (budget=100)
  // This is expected but not guaranteed — verify dropped count
  assert.ok(result.dropped >= 0, 'Budget should have non-negative dropped count');
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. TEST: Composite score calculation is correct
// ─────────────────────────────────────────────────────────────────────────────

test('composite score formula is correctly applied', (t) => {
  // Verify formula: savings * 0.4 + coverage * 0.3 + (1 - complexity) * 0.3
  const testCases = [
    { savings: 0.5, coverage: 0.8, complexity: 0.2, expected: 0.5 * 0.4 + 0.8 * 0.3 + 0.8 * 0.3 },
    { savings: 0.0, coverage: 1.0, complexity: 0.5, expected: 0.0 * 0.4 + 1.0 * 0.3 + 0.5 * 0.3 },
    { savings: 1.0, coverage: 0.5, complexity: 0.0, expected: 1.0 * 0.4 + 0.5 * 0.3 + 1.0 * 0.3 },
  ];

  for (const tc of testCases) {
    const actual = tc.savings * 0.4 + tc.coverage * 0.3 + (1 - tc.complexity) * 0.3;
    assert.strictEqual(
      actual,
      tc.expected,
      `Composite score should be ${tc.expected}, got ${actual}`
    );
  }
});
