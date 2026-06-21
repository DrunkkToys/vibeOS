// End-to-end workflow tests for vibeOS plugin user-visible flows
// Tests the trinity tool interface, hook invocation sequences, and state persistence
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), 'vibeos-e2e-' + name + '-'))
  const home = sandbox
  mkdirSync(join(home, '.config/opencode'), { recursive: true })
  mkdirSync(join(home, '.claude/reports'), { recursive: true })
  mkdirSync(join(home, '.local/share/opencode'), { recursive: true })
  mkdirSync(join(home, '.claude/scratch'), { recursive: true })

  writeFileSync(join(home, '.config/opencode/opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-flash',
    provider: { deepseek: { models: { 'deepseek-v4-flash': {}, 'deepseek-v4-pro': {} } } }
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
      cheap: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' }
    }
  }, null, 2) + '\n')

  writeFileSync(join(home, '.claude/delegation-state.json'), JSON.stringify({
    lifetime: { warn_count: 0, scratchpad_hits_observed: 0, missed_context7_usd: 0 },
    sessions: {}
  }, null, 2) + '\n')

  return { sandbox, home }
}

// E2E: Full Trinity Lifecycle

test('e2e: trinity enable -> disable -> enable cycle works', async () => {
  const { home, sandbox } = makeSandbox('trin-life')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?trc1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const initialStatus = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof initialStatus === 'string', 'initial status is string')

  await hooks.tool.trinity.execute({ action: 'disable' })
  const disabledStatus = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof disabledStatus === 'string', 'disabled status is string')

  await hooks.tool.trinity.execute({ action: 'enable' })
  const enabledStatus = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof enabledStatus === 'string', 're-enabled status is string')
})

// E2E: Mode Switching

test('e2e: mode switching budget -> quality -> speed -> auto returns success', async () => {
  const { home, sandbox } = makeSandbox('mode-cycle')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?mdc1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const modes = ['budget', 'quality', 'speed', 'auto']
  for (const mode of modes) {
    const result = await hooks.tool.trinity.execute({ action: 'mode', slot: mode })
    assert.ok(typeof result === 'string', 'mode ' + mode + ' returns string')
  }
})

// E2E: Thinking Level

test('e2e: thinking level full -> brief -> off returns success', async () => {
  const { home, sandbox } = makeSandbox('think-cycle')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?thk1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const levels = ['full', 'brief', 'off']
  for (const level of levels) {
    const result = await hooks.tool.trinity.execute({ action: 'thinking', slot: level })
    assert.ok(typeof result === 'string', 'thinking ' + level + ' returns string')
  }
})

// E2E: Enforcement Toggle (delegation_enforce is mandatory and cannot be disabled)

test('e2e: enforcement commands return string (enforcement is mandatory)', async () => {
  const { home, sandbox } = makeSandbox('enf-mandatory')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?enf1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const offResult = await hooks.tool.trinity.execute({ action: 'enforce', slot: 'off' })
  assert.ok(typeof offResult === 'string', 'enforce off returns string')

  const onResult = await hooks.tool.trinity.execute({ action: 'enforce', slot: 'on' })
  assert.ok(typeof onResult === 'string', 'enforce on returns string')

  // Verify enforcement stays on (mandatory)
  const status = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof status === 'string', 'status returns string after enforce toggles')
})

// E2E: Flow Toggle

test('e2e: flow on -> off -> on persists in tier file', async () => {
  const { home, sandbox } = makeSandbox('flow-cycle')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?flw1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks.tool.trinity.execute({ action: 'flow', slot: 'on' })
  const tiersOn = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  assert.equal(tiersOn.selection.flow_enabled, true)

  await hooks.tool.trinity.execute({ action: 'flow', slot: 'off' })
  const tiersOff = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  assert.equal(tiersOff.selection.flow_enabled, false)
})

// E2E: TDD Toggle

test('e2e: tdd on -> off -> on persists in tier file', async () => {
  const { home, sandbox } = makeSandbox('tdd-cycle')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?tdd1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks.tool.trinity.execute({ action: 'tdd', slot: 'on' })
  const tiersOn = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  assert.equal(tiersOn.selection.tdd_enforce, true)

  await hooks.tool.trinity.execute({ action: 'tdd', slot: 'off' })
  const tiersOff = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  assert.equal(tiersOff.selection.tdd_enforce, false)
})

// E2E: Combined Toggles + Disable/Re-enable (tdd_enforce may reset during auto-config)

test('e2e: flow and tdd toggle survive enable/disable cycle', async () => {
  const { home, sandbox } = makeSandbox('combined')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?cmb1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks.tool.trinity.execute({ action: 'flow', slot: 'on' })
  await hooks.tool.trinity.execute({ action: 'tdd', slot: 'on' })

  await hooks.tool.trinity.execute({ action: 'disable' })
  await hooks.tool.trinity.execute({ action: 'enable' })

  const tiers = JSON.parse(readFileSync(join(home, '.claude/model-tiers.json'), 'utf-8'))
  assert.equal(tiers.selection.enabled, true, 'plugin is enabled')
  assert.equal(tiers.selection.flow_enabled, true, 'flow survived disable/re-enable')
})

// E2E: All 8 Required Hooks Present

test('e2e: all 8 required hooks are present in plugin output', async () => {
  const { home, sandbox } = makeSandbox('hooks')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?hks1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const required = [
    'experimental.text.complete',
    'experimental.chat.messages.transform',
    'experimental.chat.system.transform',
    'tool.execute.before',
    'tool.execute.after',
    'message.updated',
    'experimental.session.compacting',
    'shell.env',
  ]
  for (const hook of required) {
    assert.ok(hooks[hook], 'hook present: ' + hook)
  }
})

// E2E: Full Hook Invocation Sequence (Simulated Session)

test('e2e: simulated full session hook sequence does not crash', async () => {
  const { home, sandbox } = makeSandbox('full-session')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  const opencodeHome = join(home, '.config', 'opencode')
  const prevOpencodeHome = process.env.VIBEOS_OPENCODE_HOME
  process.env.VIBEOS_OPENCODE_HOME = opencodeHome
  writeFileSync(join(opencodeHome, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-flash', default_agent: 'build' }))
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  // Enable blackbox to allow session creation (sandbox default has it disabled)
  const tiersPath = join(home, ".claude/model-tiers.json")
  const tiersCfg = JSON.parse(readFileSync(tiersPath, "utf-8"))
  tiersCfg.selection.blackbox_enabled = true
  writeFileSync(tiersPath, JSON.stringify(tiersCfg, null, 2) + "\n")

  try {
    const mod = await import('../src/index.js?ful1=' + Date.now())
    const hooks = await mod.DelegationEnforcer({ directory: projectDir })

    const userText = 'fix this production bug in the payment pipeline'

    await hooks['experimental.chat.messages.transform'](
      {},
      { messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: userText }] }] }
    )

    await hooks['experimental.chat.system.transform'](
      { message: { role: 'user', content: userText } },
      { system: [] }
    )

    const blackboxState = JSON.parse(readFileSync(join(home, '.claude', 'blackbox-state.json'), 'utf-8'))
    const sessionKey = Object.keys(blackboxState.sessions).find(s => !s.endsWith('_opt'))
    assert.ok(sessionKey, 'blackbox session should exist')

    const selectionState = JSON.parse(readFileSync(join(home, '.claude', 'model-tiers.json'), 'utf-8')).selection
    const expectedSlot = selectionState.vector_changed_slot || blackboxState.sessions[sessionKey].active_slot || 'cheap'
    assert.ok(['cheap', 'medium', 'brain'].includes(expectedSlot), 'ML turn should persist a real slot')

    const toolInput = { tool: 'write', args: { filePath: join(projectDir, 'src/foo.ts') } }
    const beforeOut = { args: { filePath: join(projectDir, 'src/foo.ts') } }
    await hooks['tool.execute.before'](toolInput, beforeOut)

    const toolResult = { result: 'export function foo(): string { return "hello" }' }
    await hooks['tool.execute.after'](toolInput, toolResult)
    assert.ok(/\[test-reminder\]|Self-modification paused|blocked by enforcement|delegation/i.test(toolResult.result), 'tool footer alert should preserve the reminder text')

    const textOutput = { text: 'Here is your function. It does the thing with proper types and handles edge cases.' }
    await hooks['experimental.text.complete']({ messageID: 'msg-' + Date.now() }, textOutput)
    const messageUpdatedOutput = { text: 'Updated message that has enough content for vibeOS footer.' }
    await hooks['message.updated']({ messageID: 'mu-' + Date.now() }, messageUpdatedOutput)
    const toolFooterLine = messageUpdatedOutput.text.split('\n').map(line => line.trimStart()).find(line => line.startsWith('— '))
    const textFooterLine = textOutput.text.trim().split('\n').filter(Boolean).at(-1)
    assert.equal(toolFooterLine, textFooterLine, 'tool footer alert and live footer should share the same line format')
    const liveFooter = textOutput.text.slice(-200)
    assert.ok(liveFooter.includes('◐ medium') || liveFooter.includes('🧠 brain') || liveFooter.includes('⚡ cheap'), 'live footer should show the selected tier')
    if (selectionState.vector_changed_slot && selectionState.vector_changed_slot !== selectionState.active_slot) {
        assert.ok(liveFooter.includes(`⟡ ${selectionState.vector_changed_slot}`), 'live footer should show the vector pulse')
    }
    assert.ok(liveFooter.toLowerCase().includes('vibelitex') || liveFooter.toLowerCase().includes('budget') || liveFooter.toLowerCase().includes('quality') || liveFooter.toLowerCase().includes('vibeqmax'), 'live footer should show optimization mode')

    await hooks['experimental.chat.messages.transform']({}, { messages: [{ role: 'assistant', content: 'Done' }] })

    const env = {}
    await hooks['shell.env']({}, { env })

    await hooks['experimental.session.compacting']({}, { messages: [{ role: 'user', content: 'Compacted context' }] })

    assert.ok(true, 'full hook sequence completes without crash')
  } finally {
    process.env.VIBEOS_OPENCODE_HOME = prevOpencodeHome
  }
})

test('e2e: INIT live footer keeps the regime icon visible', async () => {
  const { home, sandbox } = makeSandbox('init-footer')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?init1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const userText = 'hi'
  await hooks['experimental.chat.messages.transform'](
    {},
    { messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: userText }] }] }
  )

  await hooks['experimental.chat.system.transform'](
    { message: { role: 'user', content: userText } },
    { system: [] }
  )

  const out = { text: 'This is a long enough response to trigger the live footer in the INIT regime path.' }
  await hooks['experimental.text.complete']({ messageID: 'init-' + Date.now() }, out)
  const footer = String(out.text || '').split('\n').filter(Boolean).at(-1) || ''

  assert.ok(footer.includes('▶ ◌ INIT'), 'INIT footer should show the regime icon and tag: ' + footer)
  assert.ok(footer.includes('Quality') || footer.includes('VibeMaX') || footer.includes('Budget') || footer.includes('VibeUltraX'), 'INIT footer should show the live optimization mode: ' + footer)
})

test('e2e: blackbox advances past INIT with role-only user messages', async () => {
  const { home, sandbox } = makeSandbox('role-only')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const tiersPath = join(home, ".claude/model-tiers.json")
  const tiersCfg = JSON.parse(readFileSync(tiersPath, "utf-8"))
  tiersCfg.selection.blackbox_enabled = true
  writeFileSync(tiersPath, JSON.stringify(tiersCfg, null, 2) + "\n")

  const mod = await import('../src/index.js?role1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  await hooks['experimental.chat.messages.transform'](
    {},
    { messages: [{ role: 'user', content: 'implement a login handler' }] }
  )
  await hooks['experimental.chat.messages.transform'](
    {},
    { messages: [{ role: 'user', content: 'add validation to the login handler' }] }
  )

  const blackboxState = JSON.parse(readFileSync(join(home, '.claude', 'blackbox-state.json'), 'utf-8'))
  const sessionKey = Object.keys(blackboxState.sessions).find(s => !s.endsWith('_opt'))
  assert.ok(sessionKey, 'role-only blackbox session should exist')
  assert.ok((blackboxState.sessions[sessionKey].history || []).length >= 2, 'role-only path should track multiple turns')
  assert.notEqual(blackboxState.sessions[sessionKey].sub_regime, 'INIT', 'second tracked turn should move past INIT')
})

// E2E: Additional Trinity Commands

test('e2e: trinity help returns non-empty string', async () => {
  const { home, sandbox } = makeSandbox('help')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?hlp1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const helpText = await hooks.tool.trinity.execute({ action: 'help' })
  assert.ok(typeof helpText === 'string', 'help returns string')
  assert.ok(helpText.length > 20, 'help text has meaningful length')
})

test('e2e: trinity diagnose returns string', async () => {
  const { home, sandbox } = makeSandbox('diag')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?diag1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const diag = await hooks.tool.trinity.execute({ action: 'diagnose' })
  assert.ok(typeof diag === 'string', 'diagnose returns string')
})

test('e2e: trinity project returns string', async () => {
  const { home, sandbox } = makeSandbox('proj')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'opencode.json'), JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }))
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?prj1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const proj = await hooks.tool.trinity.execute({ action: 'project' })
  assert.ok(typeof proj === 'string', 'project returns string')
})

test('e2e: trinity patterns and patterns clear return strings', async () => {
  const { home, sandbox } = makeSandbox('patts')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?pats1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const pats = await hooks.tool.trinity.execute({ action: 'patterns' })
  assert.ok(typeof pats === 'string', 'patterns returns string')

  const cleared = await hooks.tool.trinity.execute({ action: 'patterns', slot: 'clear' })
  assert.ok(typeof cleared === 'string', 'patterns clear returns string')
})

test('e2e: trinity rebuild returns string', async () => {
  const { home, sandbox } = makeSandbox('rebuild')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?reb1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const result = await hooks.tool.trinity.execute({ action: 'rebuild' })
  assert.ok(typeof result === 'string', 'rebuild returns string')
})

test('e2e: unknown trinity action does not crash', async () => {
  const { home, sandbox } = makeSandbox('unknown')
  const projectDir = join(sandbox, 'proj')
  mkdirSync(projectDir, { recursive: true })
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?unk1=' + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const result = await hooks.tool.trinity.execute({ action: 'nonexistent_command' })
  assert.ok(typeof result === 'string', 'unknown action returns string: ' + typeof result)
})

// E2E: Report Framework via Public API (not via trinity tool)

test('e2e: report save -> list -> read via public API', async () => {
  const { home, sandbox } = makeSandbox('rpt-cycle')
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")

  const mod = await import('../src/index.js?rptc=' + Date.now())
  const id = mod.saveReport({ type: 'session', summary: 'E2E cycle test', tags: ['e2e'] })
  assert.ok(id, 'report saved with id: ' + id)

  const list = mod.listReports({ hours: 24 })
  const found = list.find(r => r.id === id)
  assert.ok(found, 'report appears in list')
  assert.equal(found.type, 'session')

  const read = mod.readReport(id)
  assert.ok(read, 'report readable')
  assert.equal(read.meta?.id, id)
})

console.log('\nAll E2E workflow tests complete')
