import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const sandbox = mkdtempSync(join(tmpdir(), 'vibeos-project-memory-'))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, '.claude')
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

const { projectMemoryDirective } = await import('../chat-transform.js?' + Date.now())

describe('projectMemoryDirective', () => {
  it('compresses project memory into a compact prompt directive', () => {
    const dir = join(sandbox, 'workbench-project')
    const fp = createHash('sha256').update(dir).digest('hex').slice(0, 12)
    const noisyTopic = 'a very long recurring topic ' + 'with repeated details '.repeat(8)
    writeFileSync(join(process.env.VIBEOS_HOME, 'project-states.json'), JSON.stringify({
      project_hashes: {
        [fp]: {
          projectName: 'Workbench Project',
          totalSessions: 12,
          reports: ['r1', 'r2', 'r3'],
          researchChains: 4,
          context7Bypasses: 2,
          techStack: ['typescript', 'javascript', 'node'],
          commonTopics: [noisyTopic, 'git status', 'typecheck'],
          userPatterns: {
            friction: {
              'repeat-typecheck': {
                kind: 'friction',
                summary: 'After editing source files, typecheck often fails until imports are aligned.',
                sessions: ['s1', 's2', 's3'],
                lastSeen: '2026-06-17T00:00:00.000Z',
              },
            },
            routines: {
              'run-tests': {
                kind: 'routine',
                summary: 'After code edits, run tests before closing the task.',
                sessions: ['s1', 's2', 's3'],
                lastSeen: '2026-06-17T00:00:00.000Z',
              },
            },
          },
        },
      },
    }, null, 2))

    const statePath = join(process.env.VIBEOS_HOME, 'delegation-state.json')
    const before = (() => {
      try { return JSON.parse(readFileSync(statePath, 'utf8')) } catch { return null }
    })()
    const result = projectMemoryDirective(fp)
    const after = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.ok(result, 'directive should be generated')
    assert.ok(result.startsWith('[project memory: compressed] Active project: Workbench Project.'), result)
    assert.ok(result.includes('Sessions: 12.'), result)
    assert.ok(result.includes('Reports: 3.'), result)
    assert.ok(result.includes('Tech: typescript, javascript, node.'), result)
    assert.ok(result.includes('[friction]') || result.includes('[routine]'), result)
    assert.ok(result.length < 450, `directive should stay compact: ${result.length} chars`)
    assert.equal(result.includes(noisyTopic), false, 'directive should not echo the full noisy topic')
    assert.ok(Number(after?.lifetime?.cache_savings_usd || 0) > Number(before?.lifetime?.cache_savings_usd || 0), 'compression should add to existing cache savings')
  })
})

process.on('exit', () => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})
