import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { writeFileSync, unlinkSync, existsSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sessionDuration, elapsedNew, formatDuration, startTimer, getElapsedSeconds } from '../timer.js'

function _statePath(name = 'delegation-state.json') {
  return join(homedir(), '.claude', name)
}
const BACKUP_SUFFIX = '.experiment-backup'

function backupStateFile() {
  const sf = _statePath()
  const bf = _statePath('delegation-state.json' + BACKUP_SUFFIX)
  if (existsSync(sf)) {
    renameSync(sf, bf)
  }
}

function restoreStateFile() {
  const sf = _statePath()
  const bf = _statePath('delegation-state.json' + BACKUP_SUFFIX)
  if (existsSync(sf)) unlinkSync(sf)
  if (existsSync(bf)) renameSync(bf, sf)
}

let _origHome
before(() => {
  _origHome = process.env.HOME
})
after(() => {
  process.env.HOME = _origHome
})

function writeTestState(data) {
  const dir = join(homedir(), '.claude')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(_statePath(), JSON.stringify(data))
}

describe('getElapsedSeconds', () => {
  it('returns 0 for nullish startTime', () => {
    assert.strictEqual(getElapsedSeconds(null), 0)
    assert.strictEqual(getElapsedSeconds(undefined), 0)
  })

  it('returns positive seconds for past time', () => {
    const past = new Date(Date.now() - 5000).toISOString()
    const s = getElapsedSeconds(past)
    assert.ok(s >= 4 && s <= 10, `expected ~5s, got ${s}`)
  })

  it('returns 0 for invalid date', () => {
    assert.strictEqual(getElapsedSeconds('invalid'), 0)
  })
})

describe('elapsedNew', () => {
  it('returns 0m 0s for nullish startTime', () => {
    assert.strictEqual(elapsedNew(null), '0m 0s')
    assert.strictEqual(elapsedNew(undefined), '0m 0s')
  })

  it('returns a time string for a valid past startTime', () => {
    const past = new Date(Date.now() - 61000).toISOString()
    const result = elapsedNew(past)
    assert.match(result, /^1m \d+s$/)
  })
})

describe('formatDuration', () => {
  it('formats zero duration', () => {
    assert.strictEqual(formatDuration({ hours: 0, minutes: 0, seconds: 0 }), '0h 0m 0s')
  })

  it('formats hours and minutes', () => {
    assert.strictEqual(formatDuration({ hours: 1, minutes: 30, seconds: 45 }), '1h 30m 45s')
  })

  it('handles missing fields gracefully', () => {
    assert.strictEqual(formatDuration({ hours: undefined }), '0h 0m 0s')
    assert.strictEqual(formatDuration({ minutes: undefined }), '0h 0m 0s')
    assert.strictEqual(formatDuration({}), '0h 0m 0s')
  })

  it('handles null fields gracefully', () => {
    assert.strictEqual(formatDuration({ hours: null, minutes: 5, seconds: null }), '0h 5m 0s')
  })

  it('accepts raw seconds as number', () => {
    assert.strictEqual(formatDuration(65), '0h 1m 5s')
  })

  it('accepts raw seconds 0', () => {
    assert.strictEqual(formatDuration(0), '0h 0m 0s')
  })

  it('accepts raw seconds with hours', () => {
    assert.strictEqual(formatDuration(3661), '1h 1m 1s')
  })
})

describe('sessionDuration', () => {
  beforeEach(() => {
    backupStateFile()
  })

  afterEach(() => {
    restoreStateFile()
  })

  it('returns zeros when state file does not exist', () => {
    const sf = _statePath()
    if (existsSync(sf)) unlinkSync(sf)
    const result = sessionDuration()
    assert.deepStrictEqual(result, { hours: 0, minutes: 0, seconds: 0 })
  })

  it('returns zeros when session_started_at is invalid date', () => {
    writeTestState({ session_started_at: 'not-a-valid-date' })
    const result = sessionDuration()
    assert.deepStrictEqual(result, { hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('sessionDuration with custom path', () => {
  const tmpFile = join(homedir(), '.claude/delegation-state-test.json')

  beforeEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile)
  })

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile)
  })

  it('reads from custom path when provided', () => {
    writeFileSync(tmpFile, JSON.stringify({ session_started_at: new Date(Date.now() - 60000).toISOString() }))
    const result = sessionDuration(tmpFile)
    assert.ok(result.minutes >= 1 || result.seconds >= 59, 'expected at least ~60s of elapsed')
  })

  it('returns zeros when custom path file does not exist', () => {
    const result = sessionDuration('/nonexistent/path/file.json')
    assert.deepStrictEqual(result, { hours: 0, minutes: 0, seconds: 0 })
  })

  it('returns zeros when custom path has invalid JSON', () => {
    writeFileSync(tmpFile, 'not json')
    const result = sessionDuration(tmpFile)
    assert.deepStrictEqual(result, { hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('startTimer', () => {
  it('returns an ISO string', () => {
    const t = startTimer()
    assert.ok(typeof t === 'string')
    assert.ok(t.includes('T'))
  })
})
