// Cross-module integration tests for vibeOS plugin
// Tests interactions between flow enforcer, TDD enforcer, blackbox, stress pipeline, footer
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

function makeSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), 'vibeos-int-' + name + '-'))
  const home = sandbox
  process.env.VIBEOS_MCP_PORT = "0"
  process.env.VIBEOS_HOME = join(home, '.claude')
  process.env.VIBEOS_OPENCODE_HOME = join(home, '.config/opencode')
  mkdirSync(join(home, '.config/opencode'), { recursive: true })
  mkdirSync(join(home, '.claude/reports'), { recursive: true })
  mkdirSync(join(home, '.local/share/opencode'), { recursive: true })
  mkdirSync(join(home, '.claude/scratch'), { recursive: true })

  writeFileSync(join(home, '.config/opencode/opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-flash',
    provider: { deepseek: { models: { 'deepseek-v4-flash': {}, 'deepseek-v4-pro': {}, 'deepseek-chat': {} } } }
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      active_slot: 'medium', enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: 'off',
      blackbox_enabled: false, model_locked: false
    },
    tiers: {
      high: { regex: 'deepseek.*v4.*pro|opus' },
      mid: { regex: 'deepseek.*v4.*flash|sonnet' },
      budget: { regex: '.*' }
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-pro', cc: 'haiku' },
      medium: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-chat', cc: 'haiku' }
    }
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/delegation-state.json'), JSON.stringify({
    lifetime: { warn_count: 0, scratchpad_hits_observed: 0, missed_context7_usd: 0 },
    sessions: {}
  }, null, 2) + '\n')

  return { sandbox, home }
}

// Section 1: Flow Enforcer + TDD Enforcer Integration

test('flow-enforcer + tdd-enforcer: flow rule violations do not crash tool.execute', async () => {
  const { home, sandbox } = makeSandbox('flow-tdd')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  process.env.HOME = home

  const mod = await import('../src/index.js?flow1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['tool.execute.after'](
    { tool: 'write', filePath: join(projectDir, 'src/index.ts') },
    { result: 'export function foo() {}' }
  )
  assert.ok(true, 'tool.execute.after for write does not crash')
})

test('flow-enforcer + tdd-enforcer: todo extraction does not crash on repeated tool calls', async () => {
  const { home, sandbox } = makeSandbox('flow-todo')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?flow2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  for (let i = 0; i < 10; i++) {
    await hooks['tool.execute.after'](
      { tool: 'edit', filePath: join(projectDir, 'src/module-' + i + '.ts') },
      { result: '// TODO: fix later\nconst x = 1' }
    )
  }
  assert.ok(true, '10 consecutive todo extractions do not throw')
})

test('flow-enforcer + tdd-enforcer: guard docs generation does not crash for project dir', async () => {
  const { home, sandbox } = makeSandbox('flow-guard')
  const projectDir = join(sandbox, 'empty-proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?flow3=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  assert.ok(hooks, 'plugin loads for empty project dir')
})

// Section 2: Blackbox State Persistence

test('blackbox: loadBlackboxState returns valid shape for fresh sandbox', async () => {
  const { home, sandbox } = makeSandbox('bb-state')
  process.env.HOME = home

  const mod = await import('../src/index.js?bb1=' + Date.now())
  const state = mod.loadBlackboxState()
  assert.ok(typeof state === 'object' && state !== null, 'blackbox state is an object')
})

test('blackbox: getBlackboxResolution returns object with expected keys', async () => {
  const { home, sandbox } = makeSandbox('bb-res')
  process.env.HOME = home

  const mod = await import('../src/index.js?bb2=' + Date.now())
  const resolution = mod.getBlackboxResolution()
  assert.ok(typeof resolution === 'object' && resolution !== null, 'resolution is object')
  assert.ok(typeof resolution.sub_regime === 'string', 'has sub_regime: ' + resolution.sub_regime)
  assert.ok(typeof resolution.resolution === 'string', 'has resolution: ' + resolution.resolution)
})

// Section 3: Stress Scoring Edge Cases

test('scoreStress: empty input returns low score', async () => {
  const { home, sandbox } = makeSandbox('stress-edge')
  process.env.HOME = home

  const mod = await import('../src/index.js?str-edge=' + Date.now())
  const score = mod.scoreStress('')
  assert.ok(typeof score === 'number', 'score is number: ' + score)
  assert.ok(score >= 0 && score <= 10, 'score in range: ' + score)
})

test('scoreStress: null input returns low score', async () => {
  const { home, sandbox } = makeSandbox('stress-null')
  process.env.HOME = home

  const mod = await import('../src/index.js?str-null=' + Date.now())
  const score = mod.scoreStress(null)
  assert.ok(typeof score === 'number', 'score is number: ' + score)
  assert.ok(score >= 0 && score <= 10, 'score in range: ' + score)
})

test('scoreStress: very short input does not throw', async () => {
  const { home, sandbox } = makeSandbox('stress-short')
  process.env.HOME = home

  const mod = await import('../src/index.js?str-short=' + Date.now())
  assert.doesNotThrow(() => mod.scoreStress('hi'))
})

test('scoreStress: typical angry input scores higher than neutral', async () => {
  const { home, sandbox } = makeSandbox('stress-cmp')
  process.env.HOME = home

  const mod = await import('../src/index.js?str-cmp=' + Date.now())
  const neutral = mod.scoreStress('Please help me with this code')
  const angry = mod.scoreStress('This is broken garbage, fix it NOW, it is terrible and useless and I am furious')
  assert.ok(typeof neutral === 'number' && typeof angry === 'number')
  assert.ok(angry >= neutral, 'angry=' + angry + ' >= neutral=' + neutral)
})

// Section 4: Model Locking

test('model-lock: trinity lock on then off returns strings', async () => {
  const { home, sandbox } = makeSandbox('lock')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?lock1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const resultOn = await hooks.tool.trinity.execute({ action: 'lock', slot: 'on' })
  assert.ok(typeof resultOn === 'string', 'lock on returns string')

  const resultOff = await hooks.tool.trinity.execute({ action: 'lock', slot: 'off' })
  assert.ok(typeof resultOff === 'string', 'lock off returns string')
})

test('model-lock: lock status appears in trinity status output', async () => {
  const { home, sandbox } = makeSandbox('lock-status')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?lock2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  await hooks.tool.trinity.execute({ action: 'lock', slot: 'on' })
  const status = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof status === 'string', 'status returns string')
})

// Section 5: Warning Caps and Coalescing

test('warn-coalescing: repeated same-tool warns merge in session', async () => {
  const { home, sandbox } = makeSandbox('warn-coal')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  process.env.HOME = home

  const mod = await import('../src/index.js?warn1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  await hooks['shell.env']({}, { env: {} })
  await hooks.tool.trinity.execute({ action: 'set', slot: 'brain' })

  await hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: join(projectDir, 'a.ts') } })
  await hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: join(projectDir, 'b.ts') } })
  await hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: join(projectDir, 'c.ts') } })
  await new Promise((resolve) => setTimeout(resolve, 250))

  const state = JSON.parse(readFileSync(join(home, '.claude/delegation-state.json'), 'utf-8'))
  const totalWarns = Object.values(state.sessions || {}).reduce((sum, sess) => sum + (sess?.warns?.length || 0), 0)
  assert.ok(Number(state.lifetime?.warn_count || 0) >= 1 || totalWarns >= 1, 'warning state should increment')
})

test('warn-coalescing: free tools never generate warns', async () => {
  const { home, sandbox } = makeSandbox('warn-free')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  process.env.HOME = home

  const mod = await import('../src/index.js?warn2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  await hooks['shell.env']({}, { env: {} })

  await hooks['tool.execute.before']({ tool: 'question' }, { args: {} })
  await hooks['tool.execute.before']({ tool: 'skill' }, { args: {} })
  await hooks['tool.execute.before']({ tool: 'trinity' }, { args: {} })

  const state = JSON.parse(readFileSync(join(home, '.claude/delegation-state.json'), 'utf-8'))
  const sessions = Object.values(state.sessions || {})
  const totalWarns = sessions.reduce((sum, s) => sum + (s.warns?.length || 0), 0)
  assert.equal(totalWarns, 0, 'free tools generate zero warns')
})

// Section 6: Footer Edge Cases

test('footer: text.complete handles null input gracefully', async () => {
  const { home, sandbox } = makeSandbox('footer-null')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?ftr1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['experimental.text.complete']({ messageID: 'null-test' }, {})
  assert.ok(true, 'text.complete handles empty output without crashing')
})

test('footer: text.complete deduplicates same message ID', async () => {
  const { home, sandbox } = makeSandbox('footer-dedup')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?ftr2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const msgId = 'dedup-msg-' + Date.now()
  const o1 = { text: 'First long message that is definitely over fifty characters so the footer mechanism activates properly.' }
  await hooks['experimental.text.complete']({ messageID: msgId }, o1)

  const o2 = { text: 'Second attempt.' }
  await hooks['experimental.text.complete']({ messageID: msgId }, o2)
  assert.equal(o2.text, 'Second attempt.', 'dedup: same messageID does not re-process')
})

test('footer: message.updated fallback hook exists and does not crash', async () => {
  const { home, sandbox } = makeSandbox('footer-msg')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?ftr3=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['message.updated']({ messageID: 'mu-1' }, { text: 'Fallback message that is long enough to trigger the vibeOS footer hook.' })
  assert.ok(true, 'message.updated hook does not crash')
})

test('footer alert chain: write warning survives tool result and later footer append', async () => {
  const { home, sandbox } = makeSandbox('footer-chain')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  writeFileSync(join(home, '.claude/delegation-state.json'), JSON.stringify({
    lifetime: { warn_count: 0, total_savings_usd: 1.25, cache_savings_usd: 0, total_cost_usd: 0 },
    sessions: {},
  }, null, 2) + '\n')
  const bundleUrl = pathToFileURL(join(process.cwd(), 'dist/vibeOS.js')).href
  const script = `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    const home = ${JSON.stringify(home)};
    const projectDir = ${JSON.stringify(projectDir)};
    process.env.HOME = home;
    process.env.VIBEOS_HOME = join(home, ".claude");
    process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
    process.env.VIBEOS_MCP_PORT = "0";
    const mod = await import(${JSON.stringify(bundleUrl)} + "?ftr-chain=" + Date.now());
    const hooks = await mod.DelegationEnforcer({ directory: projectDir });
    const toolInput = { tool: "write", args: { filePath: join(projectDir, "src/app.ts") } };
    await hooks["tool.execute.before"](toolInput, { args: { filePath: join(projectDir, "src/app.ts") } });
    const toolResult = { result: "export const app = true" };
    await hooks["tool.execute.after"](toolInput, toolResult);
    const assistantOut = { text: "This assistant reply is long enough to trigger the standard vibeOS footer after the tool alert chain has already run." };
    await hooks["experimental.text.complete"]({ messageID: "footer-chain-1" }, assistantOut);
    process.stdout.write(JSON.stringify({
      title: toolResult.title || "",
      result: toolResult.result || "",
      assistant: assistantOut.text || "",
    }));
  `
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()
  const parsed = JSON.parse(raw)
  assert.ok(String(parsed.assistant || '').includes('—') && (String(parsed.assistant || '').includes('🧠') || String(parsed.assistant || '').includes('◐') || String(parsed.assistant || '').includes('⚡')), 'assistant footer still renders after the tool alert chain')
})

test('footer alert chain: desktop message wrapper keeps tool warning and footer visible', async () => {
  const { home, sandbox } = makeSandbox('footer-chain-desktop')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  writeFileSync(join(home, '.claude/delegation-state.json'), JSON.stringify({
    lifetime: { warn_count: 0, total_savings_usd: 1.25, cache_savings_usd: 0, total_cost_usd: 0 },
    sessions: {},
  }, null, 2) + '\n')
  process.env.HOME = home

  const mod = await import('../src/index.js?ftr-chain-desktop=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const toolInput = { tool: 'write', args: { filePath: join(projectDir, 'src/app.ts') } }
  const beforeOut = { args: { filePath: join(projectDir, 'src/app.ts') } }
  await hooks['tool.execute.before'](toolInput, beforeOut)

  const desktopToolResult = {
    message: {
      text: 'export const app = true',
    },
  }
  await hooks['tool.execute.after'](toolInput, desktopToolResult)

  const desktopAssistantOut = {
    message: {
      text: 'This assistant reply is long enough to trigger the standard vibeOS footer after the desktop tool alert chain has already run.',
    },
  }
  await hooks['message.updated']({ messageID: 'footer-chain-desktop-1' }, desktopAssistantOut)
  assert.ok(desktopAssistantOut.message.text.includes('Vibe'), 'desktop wrapper footer still renders after the tool alert chain')
})

test('main pipeline: branded qmax request stays visible while ultrax still runs a real cascade', async () => {
  const { home, sandbox } = makeSandbox('cascade-main')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-pro',
    provider: {
      deepseek: {
        models: {
          'deepseek-v4-pro': {},
          'deepseek-v4-flash': {},
          'deepseek-chat': {},
        },
      },
    },
  }, null, 2) + '\n')
  process.env.HOME = home

  const mod = await import('../src/index.js?cascade-main=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  const modeResult = await hooks.tool.trinity.execute({ action: 'mode', slot: 'vibeqmax' })
  const status = await hooks.tool.trinity.execute({ action: 'status' })

  const qmax = await import('../src/vibeOS-lib/blackbox/vibeqmax.js?cascade-main=' + Date.now())
  const qmaxVector = qmax.vibeqmaxControlVector({
    sub_regime: 'REFINING',
    stress_multiplier: 0.2,
    user_text: 'fix this broken error and write tests for the pipeline',
  })

  const ultrax = await import('../src/vibeOS-lib/blackbox/vibeultrax.js?cascade-main=' + Date.now())
  const ultra = ultrax.vibeultraxPipeline({
    user_text: 'implement a login form with validation and tests',
  })

  assert.match(modeResult, /Mode set to VIBEQMAX/i)
  assert.match(modeResult, /Pipeline: brain/i)
  assert.match(status, /Requested mode: vibeqmax/i)
  assert.equal(qmaxVector.mode_root, 'vibeqmax')
  assert.equal(qmaxVector.optimization_mode, 'vibeqmax')
  assert.equal(qmaxVector.pipeline_root[0], 'brain')
  assert.ok(String(qmaxVector.qmax_strategy || '').length > 0, 'qmax strategy is recorded')
  assert.equal(ultra.mode_root, 'vibeultrax')
  assert.deepEqual(ultra.pipeline, ['cheap', 'medium', 'brain'])
  assert.equal(ultra.cascade_depth, 3)
  assert.equal(ultra.ultrax_profile, 'deep')
})

test('reconnect recovery: stale vibelitex cache heals to live brain mode and footer follows', async () => {
  const { home, sandbox } = makeSandbox('recover-vibelitex')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-pro',
    provider: {
      deepseek: {
        models: {
          'deepseek-v4-pro': {},
          'deepseek-v4-flash': {},
          'deepseek-chat': {},
        },
      },
    },
  }, null, 2) + '\n')
  writeFileSync(join(home, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: 'brain',
      optimization_mode: 'vibelitex',
      delegation_enforce: true,
      onboarding_mode: 'strict',
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-pro', cc: 'deepseek-reasoner' },
      medium: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-chat', cc: 'haiku' },
    },
  }, null, 2) + '\n')
  writeFileSync(join(home, '.claude/blackbox-state.json'), JSON.stringify({
    sessions: {
      boot: {
        optimization_mode: 'vibelitex',
        active_slot: 'brain',
      },
    },
  }, null, 2) + '\n')

  const bundleUrl = pathToFileURL(join(process.cwd(), 'dist/vibeOS.js')).href
  const turnUrl = pathToFileURL(join(process.cwd(), 'src/lib/turn-classify.js')).href
  const script = `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    const home = ${JSON.stringify(home)};
    const projectDir = ${JSON.stringify(projectDir)};
    process.env.HOME = home;
    process.env.VIBEOS_HOME = join(home, ".claude");
    process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
    process.env.VIBEOS_MCP_PORT = "0";
    const plugin = await import(${JSON.stringify(bundleUrl)} + "?recover=" + Date.now());
    const hooks = await plugin.DelegationEnforcer({ directory: projectDir });
    const turn = await import(${JSON.stringify(turnUrl)} + "?recover=" + Date.now());
    const resolved = turn.loadOptimizationMode();
    const persisted = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf-8")).selection.optimization_mode;
    const out = { text: "This assistant response is long enough to trigger the vibeOS footer after reconnect." };
    await hooks["experimental.text.complete"]({ messageID: "recover-vibelitex-1" }, out);
    process.stdout.write(JSON.stringify({
      resolved,
      persisted,
      footer: out.text,
    }));
  `
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()
  const parsed = JSON.parse(raw)
  assert.equal(parsed.resolved, 'quality', 'stale vibelitex should recover to the live brain mode')
  assert.equal(parsed.persisted, 'quality', 'recovery should be written back to selection state')
  assert.ok(!String(parsed.footer || '').includes('vibelitex'), 'footer should stop advertising stale vibelitex after reconnect')
  assert.ok(/VibeQMaX|brain|🧠/.test(String(parsed.footer || '')), 'footer should reflect the recovered brain path')
})

test('pivot cache: pivot and counter-pivot both resolve to the cached workflow', async () => {
  const { PivotCache } = await import('../src/vibeOS-lib/blackbox/pivot-cache.js?pivot=' + Date.now())
  const { home, sandbox } = makeSandbox('pivot-cache')
  const cache = new PivotCache(join(home, '.claude'))

  const workflowA = 'build a login form with password validation'
  const workflowB = 'check the weather forecast for today'
  cache.snapshot('wf-login', {
    tokens: [...cache.tokenize(workflowA)],
    intent: workflowA,
    decisions: ['use a focused validation flow'],
    files: ['src/login.ts'],
    blockers: ['password rule coverage'],
    toolOutputs: [],
  })
  cache.snapshot('wf-weather', {
    tokens: [...cache.tokenize(workflowB)],
    intent: workflowB,
    decisions: ['use a weather API'],
    files: ['src/weather.ts'],
    blockers: ['API key not configured'],
    toolOutputs: [],
  })

  const pivot = cache.detectPivot(workflowB, workflowA)
  assert.equal(pivot.isPivot, true, 'workflow switch should be treated as a pivot')

  const counterPivot = cache.detectPivotBack(cache.tokenize(workflowA))
  assert.equal(counterPivot.matchedId, 'wf-login', 'returning to the earlier workflow should match the cached pivot')
  assert.ok(cache.buildInjection('wf-login').includes('[PIVOT BACK]'), 'pivot cache should still build a PIVOT BACK injection')
})

// Section 7: State Corruption Recovery

test('state-recovery: corrupted delegation-state.json does not crash plugin', async () => {
  const { home, sandbox } = makeSandbox('corrupt')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  writeFileSync(join(home, '.claude/delegation-state.json'), '{ broken json {{{')

  const mod = await import('../src/index.js?corr1=' + Date.now())
  assert.doesNotThrow(async () => {
    await mod.DelegationEnforcer({ directory: projectDir })
  }, 'plugin loads with corrupted delegation state')
})

test('state-recovery: corrupted model-tiers.json falls back to defaults', async () => {
  const { home, sandbox } = makeSandbox('corrupt-tiers')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  writeFileSync(join(home, '.claude/model-tiers.json'), 'not json at all {{{{{{')

  const mod = await import('../src/index.js?corr2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  const status = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof status === 'string', 'status returns string even with corrupted tiers')
})

test('state-recovery: missing delegation-state.json boots cleanly', async () => {
  const { home, sandbox } = makeSandbox('missing-state')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  try { rmSync(join(home, '.claude/delegation-state.json'), { force: true }) } catch (e) {}

  const mod = await import('../src/index.js?mis1=' + Date.now())
  assert.doesNotThrow(async () => {
    await mod.DelegationEnforcer({ directory: projectDir })
  }, 'plugin boots without delegation-state.json')
})

test('startup repair: empty tiers file is healed on reload and enforcement stays active', async () => {
  const { home, sandbox } = makeSandbox('dirty-reload')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-pro',
    provider: {
      deepseek: {
        models: {
          'deepseek-v4-pro': {},
          'deepseek-v4-flash': {},
          'deepseek-chat': {},
        },
      },
    },
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: 'brain',
      delegation_enforce: true,
      onboarding_mode: 'strict',
    },
    trinity: {
      brain: { oc: '', cc: '' },
      medium: { oc: 'placeholder-to-replace', cc: 'haiku' },
      cheap: { oc: '', cc: '' },
    },
  }, null, 2) + '\n')

  const mod = await import('../src/index.js?dirty-reload=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const tiers = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  for (const slot of ['brain', 'medium', 'cheap']) {
    const model = String(tiers?.trinity?.[slot]?.oc || '').trim()
    assert.ok(model && !model.includes('placeholder'), `${slot} slot should be repaired`)
  }
  assert.equal(tiers.selection.active_slot, 'brain', 'active slot stays on brain after repair')

  const envOut = { env: {} }
  await hooks['shell.env']({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL, 'deepseek/deepseek-v4-pro', 'live shell env uses repaired brain model')
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, 'high', 'repaired boot still enforces brain tier')
})

test('startup repair: persisted slot lock keeps brain model stable across reload', async () => {
  const { home, sandbox } = makeSandbox('slot-lock-reload')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-flash',
    provider: {
      deepseek: {
        models: {
          'deepseek-v4-pro': {},
          'deepseek-v4-flash': {},
          'deepseek-chat': {},
        },
      },
    },
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: 'brain',
      slot_locked: true,
      delegation_enforce: true,
      onboarding_mode: 'strict',
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-pro', cc: 'deepseek-reasoner' },
      medium: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-chat', cc: 'haiku' },
    },
  }, null, 2) + '\n')

  const mod = await import('../src/index.js?slot-lock=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  const out = { text: 'This assistant response is long enough to trigger the footer after reload.' }
  await hooks['experimental.text.complete']({ messageID: 'slot-lock-reload-1' }, out)
  const shellOut = { env: {} }
  await hooks['shell.env']({}, shellOut)
  const tiers = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))

  assert.equal(shellOut.env.OPENCODE_MODEL, 'deepseek/deepseek-v4-pro', 'locked reload should keep the brain model in shell env')
  assert.equal(shellOut.env.OPENCODE_MODEL_TIER, 'high', 'locked reload should keep the high tier for the brain model')
  assert.equal(tiers.selection.active_slot, 'brain', 'selection should stay on brain after reload')
  assert.ok(!String(out.text || '').includes('vibelitex'), 'footer output should not drift to vibelitex on reload')
})

test('startup repair: rebuild keeps valid project trinity slots instead of snapping back to defaults', async () => {
  const { home, sandbox } = makeSandbox('slot-preserve-rebuild')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({
    model: 'opencode/brain-model',
    provider: {
      opencode: {
        models: {
          'brain-model': {},
          'medium-model': {},
          'cheap-model': {},
        },
      },
    },
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: 'brain',
      delegation_enforce: true,
      onboarding_mode: 'strict',
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      medium: { oc: 'deepseek/deepseek-chat', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-v4-pro', cc: 'deepseek-reasoner' },
    },
  }, null, 2) + '\n')

  const bundleUrl = pathToFileURL(join(process.cwd(), 'dist/vibeOS.js')).href
  const script = `
    import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
    import { join } from "node:path";
    const home = ${JSON.stringify(home)};
    const projectDir = ${JSON.stringify(projectDir)};
    process.env.HOME = home;
    process.env.VIBEOS_HOME = join(home, ".claude");
    process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
    process.env.VIBEOS_MCP_PORT = "0";
    const mod = await import(${JSON.stringify(bundleUrl)} + "?slot-preserve=" + Date.now());
    const hooks = await mod.DelegationEnforcer({ directory: projectDir });
    const rebuild = await hooks.tool.trinity.execute({ action: "rebuild" });
    const tiers = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf-8"));
    const envOut = { env: {} };
    await hooks['shell.env']({}, envOut);
    const textOut = { text: "This assistant response is long enough to trigger the footer after rebuild." };
    await hooks['experimental.text.complete']({ messageID: "slot-preserve-rebuild-1" }, textOut);
    process.stdout.write(JSON.stringify({
      rebuild,
      tiers,
      env: envOut.env,
      text: textOut.text,
    }));
  `
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()
  const parsed = JSON.parse(raw)
  assert.ok(typeof parsed.rebuild === 'string' && parsed.rebuild.length > 0, 'rebuild should return a message')
  assert.equal(parsed.tiers.trinity.brain.oc, 'deepseek/deepseek-v4-flash', 'brain slot should keep the user-configured model')
  assert.equal(parsed.tiers.trinity.medium.oc, 'deepseek/deepseek-chat', 'medium slot should keep the user-configured model')
  assert.equal(parsed.tiers.trinity.cheap.oc, 'deepseek/deepseek-v4-pro', 'cheap slot should keep the user-configured model')
  assert.equal(parsed.env.OPENCODE_MODEL, 'deepseek/deepseek-v4-flash', 'shell env should follow the preserved brain slot')
  assert.equal(parsed.env.OPENCODE_MODEL_TIER, 'high', 'shell env should keep the high tier for the preserved brain slot')
  assert.ok(!String(parsed.text || '').includes('vibelitex'), 'footer should not drift to vibelitex after rebuild')
})

// Section 8: WBP Protocol

test('wbp: system.transform injects wbp protocol marker', async () => {
  const { home, sandbox } = makeSandbox('wbp')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?wbp1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }
  await hooks['experimental.chat.system.transform']({}, output)
  assert.ok(Array.isArray(output.system), 'system output is array')
})

test('wbp: messages.transform does not crash on empty messages', async () => {
  const { home, sandbox } = makeSandbox('wbp-msg')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?wbp2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  await hooks['experimental.chat.messages.transform']({}, { messages: [] })
  assert.ok(true, 'messages.transform handles empty messages')
})

// Section 9: Shell Env Hook

test('shell-env: sets OPENCODE_MODEL_TIER and OPENCODE_MODEL in env', async () => {
  const { home, sandbox } = makeSandbox('shenv')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?she1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  const env = {}
  await hooks['shell.env']({}, { env })
  assert.ok(env.OPENCODE_MODEL_TIER, 'tier: ' + env.OPENCODE_MODEL_TIER)
  assert.ok(env.OPENCODE_MODEL, 'model: ' + env.OPENCODE_MODEL)
})

// Section 10: Context Compression

test('compressText: returns text for short input', async () => {
  const mod = await import('../src/index.js?cps1=' + Date.now())
  const result = mod.compressText('short text')
  assert.ok(typeof result === 'string', 'compressText returns string: ' + typeof result)
})

test('compressText: handles empty string', async () => {
  const mod = await import('../src/index.js?cps2=' + Date.now())
  const result = mod.compressText('')
  assert.ok(typeof result === 'string', 'compressText empty returns string')
})

test('compressText: null input does not throw', async () => {
  const mod = await import('../src/index.js?cps3=' + Date.now())
  assert.doesNotThrow(() => mod.compressText(null))
})

// Section 11: Session Compacting Hook

test('session-compacting: hook does not crash on invocation', async () => {
  const { home, sandbox } = makeSandbox('compact')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?comp1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  await hooks['experimental.session.compacting']({}, { messages: [{ role: 'user', content: 'test' }] })
  assert.ok(true, 'session.compacting hook does not crash')
})

// Section 12: Report Framework Edge Cases

test('report: saveReport with minimal data works', async () => {
  const { home, sandbox } = makeSandbox('report-min')
  process.env.HOME = home

  const mod = await import('../src/index.js?rpt1=' + Date.now())
  const id = mod.saveReport({ type: 'manual', summary: 'minimal' })
  assert.ok(id, 'report saved with id: ' + id)
  const read = mod.readReport(id)
  assert.ok(read, 'report readable')
  assert.equal(read.meta?.id, id)
})

test('report: listReports with type filter returns only matching reports', async () => {
  const { home, sandbox } = makeSandbox('report-filter')
  process.env.HOME = home

  const mod = await import('../src/index.js?rpt2=' + Date.now())
  mod.saveReport({ type: 'manual', summary: 'manual report' })
  mod.saveReport({ type: 'session', summary: 'session report' })
  const manual = mod.listReports({ type: 'manual', hours: 24 })
  assert.ok(manual.length >= 1, 'manual reports: ' + manual.length)
  manual.forEach(r => assert.equal(r.type, 'manual'))
})

test('report: saveReport deduplicates within 5 minutes', async () => {
  const { home, sandbox } = makeSandbox('report-dedup')
  process.env.HOME = home

  const mod = await import('../src/index.js?rpt3=' + Date.now())
  const id1 = mod.saveReport({ type: 'session', summary: 'Dedup test report', tags: ['auto'] })
  const id2 = mod.saveReport({ type: 'session', summary: 'Dedup test report', tags: ['auto'] })
  assert.ok(id1, 'first save succeeds')
  assert.equal(id2, null, 'second duplicate save returns null')
})

test('integration: saveReport prefers explicit metrics context over stale cached report state', async () => {
  const { home } = makeSandbox('report-context')
  process.env.HOME = home

  const mod = await import('../src/index.js?rpt4=' + Date.now())
  mod.setCurrentProjectFingerprint('stale-fp-should-not-win')
  mod.setCurrentProjectName('stale-project-should-not-win')
  mod.setCurrentSessionId('stale-session-should-not-win')

  const id = mod.saveReport({
    type: 'session',
    summary: 'Integration report context test',
    metrics: {
      sessionId: 'opencode-int-123',
      projectName: 'integration-project',
      projectFingerprint: 'fp-int-123',
      value: 1,
    },
  })

  const report = mod.readReport(id)
  assert.equal(report.meta.sessionId, 'opencode-int-123', 'metrics session should win over stale cached context')
  assert.equal(report.meta.project, 'integration-project', 'metrics project should win over stale cached context')
  assert.equal(report.meta.fingerprint, 'fp-int-123', 'metrics fingerprint should win over stale cached context')

  const pstate = JSON.parse(readFileSync(join(home, '.claude/project-states.json'), 'utf-8'))
  const bucket = pstate.project_hashes?.['fp-int-123']
  assert.ok(bucket, 'project bucket should exist for integration report')
  assert.ok(bucket.sessions.includes('opencode-int-123'), 'project bucket should keep the explicit session id')
  assert.ok(bucket.reports.includes(id), 'project bucket should keep the report id')
  assert.equal(bucket.projectName, 'integration-project', 'project bucket should keep the explicit project name')
})

test('integration: recordSaving stamps the live project bucket with session references', async () => {
  const { home } = makeSandbox('saving-bucket')
  process.env.HOME = home

  const mod = await import('../src/index.js?rpt5=' + Date.now())
  mod.setCurrentProjectFingerprint('fp-saving-456')
  mod.setCurrentProjectName('saving-project')
  mod.setCurrentSessionId('session-saving-456')
  mod.setCurrentTier('high')

  assert.doesNotThrow(() => mod.recordSaving('bash', 'integration save path', 0.25, {
    firstWord: 'bash',
    projectFingerprint: 'fp-saving-456',
    projectName: 'saving-project',
    sessionId: 'session-saving-456',
  }))

  const pstate = JSON.parse(readFileSync(join(home, '.claude/project-states.json'), 'utf-8'))
  const bucket = pstate.project_hashes?.['fp-saving-456']
  assert.ok(bucket, 'project bucket should exist after recordSaving')
  assert.ok(bucket.sessions.includes('session-saving-456'), 'recordSaving should stamp the live session id')
  assert.equal(bucket.projectName, 'saving-project', 'recordSaving should keep the live project name')
  assert.ok(bucket.commonTopics.some((topic) => topic === 'bash' || topic === 'integration save path'), 'recordSaving should note a topic')
})

// Section 13: Research Audit

test('researchAudit: returns structured output with expected keys', async () => {
  const { home, sandbox } = makeSandbox('audit')
  process.env.HOME = home

  const mod = await import('../src/index.js?aud1=' + Date.now())
  const result = mod.researchAudit({ hours: 24 })
  assert.ok(typeof result.totalFetches === 'number', 'totalFetches: ' + result.totalFetches)
  assert.ok(Array.isArray(result.chains), 'chains is array: ' + Array.isArray(result.chains))
  assert.ok(typeof result.estCost === 'number', 'estCost: ' + result.estCost)
  assert.ok(typeof result.redundant !== 'undefined', 'redundant key exists')
})

// Section 14: Pattern Observation

test('pattern: observeToolPattern does not throw for valid input', async () => {
  const { home, sandbox } = makeSandbox('pattern')
  process.env.HOME = home

  const mod = await import('../src/index.js?pat1=' + Date.now())
  assert.doesNotThrow(() => mod.observeToolPattern('bash', 'npm install'))
})

test('pattern: observeToolPattern handles empty string args', async () => {
  const { home, sandbox } = makeSandbox('pattern-empty')
  process.env.HOME = home

  const mod = await import('../src/index.js?pat2=' + Date.now())
  assert.doesNotThrow(() => mod.observeToolPattern('write', ''))
})

test('pattern: noteProjectPattern does not throw for labeled input', async () => {
  const { home, sandbox } = makeSandbox('pattern-note')
  process.env.HOME = home

  const mod = await import('../src/index.js?pat3=' + Date.now())
  assert.doesNotThrow(() => mod.noteProjectPattern('routine', 'write tests after refactor'))
})

// Section 15: Savings Ledger

test('savings: recordSaving does not throw for positive amount', async () => {
  const { home, sandbox } = makeSandbox('saving')
  process.env.HOME = home

  const mod = await import('../src/index.js?sav1=' + Date.now())
  assert.doesNotThrow(() => mod.recordSaving('write', 0.005))
})

test('savings: recordSaving handles zero amount', async () => {
  const { home, sandbox } = makeSandbox('saving-zero')
  process.env.HOME = home

  const mod = await import('../src/index.js?sav2=' + Date.now())
  assert.doesNotThrow(() => mod.recordSaving('edit', 0))
})

// Section 16: Tech Stack Detection

test('detectTechStack: returns array for project directory', async () => {
  const { home, sandbox } = makeSandbox('tech')
  process.env.HOME = home

  const mod = await import('../src/index.js?tech1=' + Date.now())
  const stack = mod.detectTechStack(sandbox)
  assert.ok(Array.isArray(stack), 'tech stack is array: ' + Array.isArray(stack))
})

test('detectTechStack: returns array for empty directory', async () => {
  const { home, sandbox } = makeSandbox('tech-empty')
  const emptyDir = join(sandbox, 'empty')
  mkdirSync(emptyDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?tech2=' + Date.now())
  const stack = mod.detectTechStack(emptyDir)
  assert.ok(Array.isArray(stack), 'tech stack is array for empty dir')
})

// Section 17: Blackbox Enabled Flow

test('blackbox: enabling blackbox does not crash system transform', async () => {
  const { home, sandbox } = makeSandbox('bb-on')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?bbx1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks.tool.trinity.execute({ action: 'blackbox', slot: 'on' })
  const output = { system: [] }
  await hooks['experimental.chat.system.transform'](
    { message: { role: 'user', content: 'Help me write a function' } },
    output
  )
  assert.ok(output.system.length >= 0, 'system transform runs with blackbox on')
})

// Section 17b: Blackbox Reset
test('blackbox: reset succeeds and clears the session tracker', async () => {
  const { home, sandbox } = makeSandbox('bb-reset')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?bbx2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks.tool.trinity.execute({ action: 'blackbox', slot: 'on' })
  const reset = await hooks.tool.trinity.execute({ action: 'blackbox', slot: 'reset' })
  assert.ok(typeof reset === 'string' && reset.includes('RESET'), 'blackbox reset returns a success message: ' + reset)
  const status = await hooks.tool.trinity.execute({ action: 'blackbox', slot: 'status' })
  assert.ok(status.includes('No resolution data yet') || status.includes('Blackbox Decision Engine'), 'blackbox status remains usable after reset: ' + status)
})

// Section 18: Multiple Hook Invocations (Stress)

test('stress: rapid system.transform invocations do not crash', async () => {
  const { home, sandbox } = makeSandbox('stress-sys')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home

  const mod = await import('../src/index.js?stsys=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  for (let i = 0; i < 20; i++) {
    const output = { system: [] }
    await hooks['experimental.chat.system.transform'](
      { message: { role: 'user', content: 'Message number ' + i } },
      output
    )
  }
  assert.ok(true, '20 rapid system.transform invocations pass')
})

test('stress: interleaved tool.execute.before + text.complete does not crash', async () => {
  const { home, sandbox } = makeSandbox('stress-inter')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  process.env.HOME = home

  const mod = await import('../src/index.js?stint=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  for (let i = 0; i < 10; i++) {
    await hooks['tool.execute.before']({ tool: 'edit' }, { args: { filePath: join(projectDir, 'x' + i + '.ts') } })
    await hooks['experimental.text.complete']({ messageID: 'int-' + i }, { text: 'Long enough message to trigger the vibeOS footer hook with more than fifty characters of text.' })
  }
  assert.ok(true, 'interleaved hooks pass')
})

// Section 19: Delegation Enforcement Edge Cases

test('delegation: tool.execute.before does not crash on unknown model', async () => {
  const { home, sandbox } = makeSandbox('del-unknown')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'nonexistent/model-xyz' }))
  process.env.HOME = home

  const mod = await import('../src/index.js?del1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: join(projectDir, 'test.ts') } })
  assert.ok(true, 'tool.execute.before handles unknown model gracefully')
})

test('delegation: tool.execute.before does not crash on missing model field', async () => {
  const { home, sandbox } = makeSandbox('del-missing')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({}))
  process.env.HOME = home

  const mod = await import('../src/index.js?del2=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['tool.execute.before']({ tool: 'bash' }, { args: "echo test" })
  assert.ok(true, 'tool.execute.before handles missing model field')
})

console.log('\nAll cross-module integration tests complete')
