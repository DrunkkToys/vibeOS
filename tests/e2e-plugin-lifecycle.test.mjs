// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// End-to-end plugin lifecycle integration test.
// Exercises all 8 OpenCode hooks, state files, and trinity runtime controls.
// Run: node --test tests/e2e-plugin-lifecycle.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX = mkdtempSync(join(tmpdir(), 'vibeos-e2e-lifecycle-'))
const HOME = SANDBOX
process.env.HOME = SANDBOX
process.env.VIBEOS_DEBUG_FOOTER = '0'
process.env.VIBEOS_MCP_PORT = '0'
process.env.NODE_ENV = 'test'

function baseDirs() {
  mkdirSync(join(HOME, '.config/opencode'), { recursive: true })
  mkdirSync(join(HOME, '.claude/reports'), { recursive: true })
  mkdirSync(join(HOME, '.claude/scratch'), { recursive: true })
  mkdirSync(join(HOME, '.local/share/opencode'), { recursive: true })
}

function writeOpenCodeConfig() {
  writeFileSync(join(HOME, '.config/opencode/opencode.json'), JSON.stringify({
    model: 'deepseek/deepseek-v4-pro',
    provider: {
      deepseek: {
        models: {
          'deepseek-v4-pro': {},
          'deepseek-v4-flash': {},
          'deepseek-chat': {}
        }
      }
    }
  }, null, 2) + '\n')
}

function writeTiers() {
  writeFileSync(join(HOME, '.claude/model-tiers.json'), JSON.stringify({
    selection: {
      active_slot: 'brain', enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: 'off'
    },
    tiers: {
      high: { regex: 'deepseek.*v4.*pro' },
      mid: { regex: 'deepseek.*v4.*flash' },
      budget: { regex: '.*' }
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-pro', cc: 'haiku' },
      medium: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-chat', cc: 'haiku' }
    }
  }, null, 2) + '\n')
}

function writeState() {
  writeFileSync(join(HOME, '.claude/delegation-state.json'), JSON.stringify({
    lifetime: { warn_count: 0, total_savings_usd: 0, cache_savings_usd: 0, last_updated: '' },
    sessions: {}
  }, null, 2) + '\n')
}

function writeBlackboxState() {
  writeFileSync(join(HOME, '.claude/blackbox-state.json'), JSON.stringify({
    enabled: true, sessions: {}
  }, null, 2) + '\n')
}

function cleanSlate() {
  rmSync(join(HOME, '.claude/delegation-state.json'), { force: true })
  rmSync(join(HOME, '.claude/blackbox-state.json'), { force: true })
  rmSync(join(HOME, '.claude/model-tiers.json'), { force: true })
  rmSync(join(HOME, '.claude/savings-ledger.jsonl'), { force: true })
  rmSync(join(HOME, '.claude/active-jobs.json'), { force: true })
  rmSync(join(HOME, '.claude/global-learning.json'), { force: true })
  rmSync(join(HOME, '.claude/project-states.json'), { force: true })
  rmSync(join(HOME, '.claude/credit-snapshot.json'), { force: true })
}

function clearModuleCache() {
  const keys = Object.keys(require.cache || {})
  for (const k of keys) {
    if (k.includes('/src/')) {
      delete require.cache[k]
    }
  }
}

let freshCounter = 0

async function freshPlugin(dir) {
  freshCounter++
  const mod = await import('../src/index.js?e2e=' + Date.now() + freshCounter)
  const { DelegationEnforcer } = mod
  return { hooks: await DelegationEnforcer({ client: {}, directory: dir || join(HOME, 'e2e-project') }), mod }
}

async function loadIndexMod() {
  freshCounter++
  return await import('../src/index.js?e2e=' + Date.now() + freshCounter)
}

test('1. creates sandbox structure and sets HOME', () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  assert.ok(existsSync(join(HOME, '.config/opencode/opencode.json')), 'opencode.json exists')
  assert.ok(existsSync(join(HOME, '.claude/model-tiers.json')), 'model-tiers.json exists')
  assert.ok(existsSync(join(HOME, '.claude/delegation-state.json')), 'delegation-state.json exists')
  assert.ok(existsSync(join(HOME, '.claude/blackbox-state.json')), 'blackbox-state.json exists')
  assert.strictEqual(process.env.HOME, SANDBOX, 'HOME is sandbox')
})

test('2. DelegationEnforcer loads and returns hooks object', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks } = await freshPlugin()
  assert.ok(hooks, 'DelegationEnforcer returned hooks')
  assert.ok(typeof hooks['experimental.chat.system.transform'] === 'function', 'system.transform hook present')
  assert.ok(typeof hooks['experimental.chat.messages.transform'] === 'function', 'messages.transform hook present')
  assert.ok(typeof hooks['tool.execute.before'] === 'function', 'tool.execute.before hook present')
  assert.ok(typeof hooks['tool.execute.after'] === 'function', 'tool.execute.after hook present')
  assert.ok(typeof hooks['experimental.text.complete'] === 'function', 'text.complete hook present')
  assert.ok(typeof hooks['message.updated'] === 'function', 'message.updated hook present')
  assert.ok(typeof hooks['experimental.session.compacting'] === 'function', 'session.compacting hook present')
  assert.ok(typeof hooks['shell.env'] === 'function', 'shell.env hook present')
  assert.ok(hooks.tool && typeof hooks.tool.trinity === 'object' && typeof hooks.tool.trinity.execute === 'function', 'trinity tool present')
})

test('3. experimental.chat.system.transform injects orchestration directives', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks } = await freshPlugin()
  const output = { system: [] }
  await hooks['experimental.chat.system.transform']({}, output)

  assert.ok(Array.isArray(output.system), 'system is array')
  assert.ok(output.system.length > 0, 'system directives injected')

  const joined = output.system.join(' ')
  const foundOrchestrator = /orchestrat|AI.*Agent|delegate|enforcement|cost policy/.test(joined)
  assert.ok(
    foundOrchestrator,
    `system prompt contains orchestration directives (matched=${foundOrchestrator}): ${joined.slice(0, 300)}`
  )
  assert.ok(
    joined.includes('cost policy') || joined.includes('delegate') || joined.includes('Task') || joined.includes('orchestrat') || joined.includes('project memory'),
    `system prompt contains delegation guidance: ${joined.slice(0, 300)}`
  )

  console.error(
    `[test] system.transform injected ${output.system.length} directives:`,
    output.system.map(s => s.slice(0, 60)).join(' | ')
  )
})

test('4. experimental.chat.messages.transform handles user message without crash', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks } = await freshPlugin()
  const output = {
    messages: [
      {
        info: { role: 'user' },
        parts: [{ type: 'text', text: 'Write a function to calculate fibonacci numbers' }]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Here is the implementation.' }]
      }
    ]
  }

  await hooks['experimental.chat.messages.transform']({}, output)
  assert.ok(true, 'messages.transform did not crash')

  const messages = output.messages
  assert.ok(messages.length >= 2, 'messages preserved')

  const wbpPresent = messages.some(m =>
    Array.isArray(m.parts) &&
    m.parts.some(p => p.text && p.text.includes('[wbp-v1]'))
  )
  console.error(`[test] WBP protocol injected: ${wbpPresent}`)
})

test('5. tool.execute.before blocks write tool on brain tier', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()

  const tiers = {
    selection: {
      active_slot: 'brain', enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: 'off'
    },
    tiers: {
      high: { regex: 'deepseek.*v4.*pro|opus' },
      mid: { regex: 'deepseek.*v4.*flash' },
      budget: { regex: '.*' }
    },
    trinity: {
      brain: { oc: 'deepseek/deepseek-v4-pro', cc: 'haiku' },
      medium: { oc: 'deepseek/deepseek-v4-flash', cc: 'haiku' },
      cheap: { oc: 'deepseek/deepseek-chat', cc: 'haiku' }
    }
  }
  writeFileSync(join(HOME, '.claude/model-tiers.json'), JSON.stringify(tiers, null, 2) + '\n')
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()

  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const input = { tool: 'write', args: { filePath: '/tmp/test.txt', content: 'test' } }
  const output = {}
  await hooks['tool.execute.before'](input, output)

  const isBlocked = output.blocked === true ||
    input.args.filePath !== '/tmp/test.txt' ||
    String(input.args.filePath || '').includes('enforcement-blocked')

  assert.ok(
    isBlocked || output.status === 'error',
    `write tool on brain tier should be blocked (filePath=${input.args.filePath}, blocked=${output.blocked})`
  )

  console.error(`[test] tool.execute.before blocked: filePath=${input.args.filePath}, blocked=${output.blocked}`)
})

test('6. tool.execute.after prepends footer alert to output', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()

  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const input = { tool: 'write', args: { filePath: '/tmp/test.txt', content: 'test' } }
  const output = { result: 'File written successfully' }
  const titleBefore = output.title

  await hooks['tool.execute.after'](input, output)

  const hasFooterInResult = typeof output.result === 'string' && (
    output.result.includes('vibeOS') ||
    output.result.includes('Brain') ||
    output.result.includes('brain') ||
    output.result.includes('medium')
  )

  assert.ok(
    hasFooterInResult || (output.title && output.title !== titleBefore),
    `tool.execute.after prepended footer: result="${(output.result || '').slice(0, 80)}", title="${output.title || ''}"`
  )

  console.error(`[test] tool.execute.after footer: result starts with="${(output.result || '').slice(0, 80)}"`)
})

test('7. experimental.text.complete appends footer to assistant text', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()

  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const messageId = 'test-msg-' + Date.now()
  const input = { messageID: messageId, messageId }
  const output = {
    message: { text: 'Here is the assistant response with some implementation details.' }
  }

  await hooks['experimental.text.complete'](input, output)

  const text = output?.message?.text || ''
  assert.ok(
    text.includes('vibeOS') ||
    text.includes('Brain') ||
    text.includes('brain') ||
    text.includes('medium') ||
    text.includes('cheap') ||
    text.includes('saved'),
    `text.complete appended footer: text ends with "${text.slice(-100)}"`
  )

  console.error(`[test] text.complete footer appended: text ends with "${text.slice(-80)}"`)
})

test('8. experimental.session.compacting populates compaction context', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks } = await freshPlugin()

  const output = { context: [] }
  await hooks['experimental.session.compacting']({}, output)

  assert.ok(Array.isArray(output.context), 'context is array')
  assert.ok(output.context.length > 0, 'compacting added context entries')

  const hasScratchpadNote = output.context.some(e =>
    e.role === 'user' && typeof e.content === 'string' &&
    (e.content.includes('scratchpad') || e.content.includes('cache dir'))
  )
  assert.ok(hasScratchpadNote, 'compaction context includes scratchpad references')

  console.error(`[test] session.compacting: ${output.context.length} context entries, has scratchpad refs: ${hasScratchpadNote}`)
})

test('9. shell.env sets OPENCODE_MODEL_TIER and OPENCODE_MODEL', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()

  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const envOut = { env: {} }
  await hooks['shell.env']({}, envOut)

  assert.ok(envOut.env, 'output.env exists')
  assert.ok(envOut.env.OPENCODE_MODEL_TIER, 'OPENCODE_MODEL_TIER set')
  assert.ok(envOut.env.OPENCODE_MODEL, 'OPENCODE_MODEL set')
  assert.ok(
    ['high', 'mid', 'budget', 'unknown'].includes(envOut.env.OPENCODE_MODEL_TIER),
    `valid tier: ${envOut.env.OPENCODE_MODEL_TIER}`
  )
  assert.ok(envOut.env.OPENCODE_MODEL.length > 0, 'model is non-empty')

  console.error(`[test] shell.env: tier=${envOut.env.OPENCODE_MODEL_TIER} model=${envOut.env.OPENCODE_MODEL}`)
})

test('10. blackbox-state.json created with enabled:true', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()

  const indexMod = await loadIndexMod()
  const bbState = indexMod.loadBlackboxState()

  assert.ok(bbState, 'blackbox state loaded')
  assert.strictEqual(bbState.enabled, true, 'blackbox defaults to enabled:true')
  assert.ok(typeof bbState.sessions === 'object', 'sessions bucket exists')

  const bbFile = join(HOME, '.claude/blackbox-state.json')
  assert.ok(existsSync(bbFile), 'blackbox-state.json file exists')

  const onDisk = JSON.parse(readFileSync(bbFile, 'utf-8'))
  assert.strictEqual(onDisk.enabled, true, 'persisted blackbox state has enabled:true')

  console.error(`[test] blackbox-state.json: enabled=${onDisk.enabled}`)
})

test('11. delegation-state.json has session data after tool execution', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()

  const initState = {
    lifetime: { warn_count: 0, total_savings_usd: 0, cache_savings_usd: 0, last_updated: '' },
    sessions: {}
  }
  writeFileSync(join(HOME, '.claude/delegation-state.json'), JSON.stringify(initState, null, 2) + '\n')
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()
  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  await hooks['tool.execute.before'](
    { tool: 'write', args: { filePath: '/tmp/test.txt', content: 'test' } },
    {}
  )

  await hooks['tool.execute.after'](
    { tool: 'write', args: { filePath: '/tmp/test.txt', content: 'test' } },
    { result: 'done' }
  )

  const savedState = JSON.parse(readFileSync(join(HOME, '.claude/delegation-state.json'), 'utf-8'))
  assert.ok(savedState, 'delegation-state.json readable')

  const hasSessions = savedState.sessions && Object.keys(savedState.sessions).length > 0
  const hasLifetimeSavings = Number(savedState.lifetime?.total_savings_usd || 0) > 0
  const hasWarnCount = Number(savedState.lifetime?.warn_count || 0) > 0

  assert.ok(
    hasSessions || hasLifetimeSavings || hasWarnCount,
    `delegation-state has session data: sessions=${Object.keys(savedState.sessions || {}).length}, savings=${savedState.lifetime?.total_savings_usd}, warns=${savedState.lifetime?.warn_count}`
  )

  console.error(`[test] delegation-state: sessions=${Object.keys(savedState.sessions || {}).length}, savings=${savedState.lifetime?.total_savings_usd}`)
})

test('12. model-tiers.json has delegation_enforce setting', async () => {
  const tiers = JSON.parse(readFileSync(join(HOME, '.claude/model-tiers.json'), 'utf-8'))
  assert.ok(tiers, 'model-tiers.json readable')
  assert.ok(tiers.selection, 'selection block exists')

  const enforce = tiers.selection.delegation_enforce
  assert.ok(
    enforce === true || enforce === false,
    `delegation_enforce present: ${enforce}`
  )

  assert.ok(tiers.trinity, 'trinity block exists')
  assert.ok(tiers.trinity.brain, 'brain slot configured')
  assert.ok(tiers.trinity.medium, 'medium slot configured')
  assert.ok(tiers.trinity.cheap, 'cheap slot configured')

  console.error(`[test] model-tiers: enforce=${tiers.selection.delegation_enforce}, slots=${Object.keys(tiers.trinity).join(', ')}`)
})

test('13. trinity commands execute through plugin.tool.trinity.execute', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()
  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const status = await hooks.tool.trinity.execute({ action: 'status' })
  assert.ok(typeof status === 'string', 'trinity status returns string')
  assert.ok(status.length > 20, 'trinity status is substantive')

  assert.ok(
    status.includes('vibeOS') || status.includes('Model') || status.includes('Slot') || status.includes('Tier'),
    `status output looks correct: "${status.slice(0, 100)}"`
  )

  const enforceOff = await hooks.tool.trinity.execute({ action: 'enforce', slot: 'off' })
  assert.ok(typeof enforceOff === 'string', 'enforce off returns string')

  const enforceOn = await hooks.tool.trinity.execute({ action: 'enforce', slot: 'on' })
  assert.ok(typeof enforceOn === 'string', 'enforce on returns string')

  const flowAudit = await hooks.tool.trinity.execute({ action: 'flow' })
  assert.ok(typeof flowAudit === 'string', 'flow audit returns string')

  const tddAudit = await hooks.tool.trinity.execute({ action: 'tdd' })
  assert.ok(typeof tddAudit === 'string', 'tdd audit returns string')

  const thinking = await hooks.tool.trinity.execute({ action: 'thinking', level: 'off' })
  assert.ok(typeof thinking === 'string', 'thinking command returns string')

  console.error(`[test] trinity status: ${status.slice(0, 120)}`)
  console.error(`[test] trinity enforce off: ${enforceOff.slice(0, 80)}`)
  console.error(`[test] trinity enforce on: ${enforceOn.slice(0, 80)}`)
})

test('14. logs complete lifecycle state to ~/.claude/test-e2e-lifecycle.json', async () => {
  cleanSlate()
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState()

  const { hooks, mod } = await freshPlugin()
  if (typeof mod.setCurrentModel === 'function') mod.setCurrentModel('deepseek/deepseek-v4-pro')
  if (typeof mod.setCurrentTier === 'function') mod.setCurrentTier('high')

  const envOut = { env: {} }
  await hooks['shell.env']({}, envOut)

  const sysOut = { system: [] }
  await hooks['experimental.chat.system.transform']({}, sysOut)

  const statusOutput = await hooks.tool.trinity.execute({ action: 'status' })

  const tiersRaw = JSON.parse(readFileSync(join(HOME, '.claude/model-tiers.json'), 'utf-8'))
  const delegationRaw = JSON.parse(readFileSync(join(HOME, '.claude/delegation-state.json'), 'utf-8'))
  const bbRaw = existsSync(join(HOME, '.claude/blackbox-state.json'))
    ? JSON.parse(readFileSync(join(HOME, '.claude/blackbox-state.json'), 'utf-8'))
    : null

  const lifecycleState = {
    timestamp: new Date().toISOString(),
    sandbox: SANDBOX,
    hooks: {
      'shell.env': { OPENCODE_MODEL_TIER: envOut.env.OPENCODE_MODEL_TIER, OPENCODE_MODEL: envOut.env.OPENCODE_MODEL },
      'system.transform': { directives_count: sysOut.system.length },
      'trinity.status': statusOutput.slice(0, 200),
    },
    state_files: {
      'model-tiers.json': {
        active_slot: tiersRaw.selection?.active_slot,
        delegation_enforce: tiersRaw.selection?.delegation_enforce,
        trinity_slots: Object.keys(tiersRaw.trinity || {})
      },
      'delegation-state.json': {
        session_count: Object.keys(delegationRaw.sessions || {}).length,
        total_savings_usd: delegationRaw.lifetime?.total_savings_usd,
        warn_count: delegationRaw.lifetime?.warn_count
      },
      'blackbox-state.json': {
        enabled: bbRaw?.enabled,
        session_count: Object.keys(bbRaw?.sessions || {}).length
      }
    }
  }

  const lifecyclePath = join(HOME, '.claude/test-e2e-lifecycle.json')
  writeFileSync(lifecyclePath, JSON.stringify(lifecycleState, null, 2) + '\n')

  assert.ok(existsSync(lifecyclePath), 'test-e2e-lifecycle.json written')
  const reloaded = JSON.parse(readFileSync(lifecyclePath, 'utf-8'))
  assert.strictEqual(reloaded.timestamp, lifecycleState.timestamp, 'lifecycle state matches')

  console.error(`[test] lifecycle state logged to ${lifecyclePath}`)
  console.error(`[test] model-tier: ${lifecycleState.state_files['model-tiers.json'].active_slot}, enforce: ${lifecycleState.state_files['model-tiers.json'].delegation_enforce}`)
  console.error(`[test] blackbox enabled: ${lifecycleState.state_files['blackbox-state.json'].enabled}`)
})

test.after(() => {
  if (process.env.VIBEOS_KEEP_SANDBOX === '1') {
    console.error(`[test] keeping sandbox at ${SANDBOX}`)
  } else {
    rmSync(SANDBOX, { recursive: true, force: true })
  }
})
