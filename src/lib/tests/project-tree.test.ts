import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import * as mod from '../project-tree.js'

describe('project-tree', () => {
  it('recordProjectFact returns false when fp is empty', () => {
    assert.equal(mod.recordProjectFact('', 'proj', 'main', 'fact', 'text'), false)
  })

  it('recordProjectFact returns false when text is empty', () => {
    assert.equal(mod.recordProjectFact('fp', 'proj', 'main', 'fact', ''), false)
    assert.equal(mod.recordProjectFact('fp', 'proj', 'main', 'fact', '   '), false)
  })

  it('loadProjectTree returns null when fp is empty', () => {
    assert.equal(mod.loadProjectTree(''), null)
  })

  describe('with temp vibeos home', () => {
    let tmp: string
    let prevVibeosHome: string | undefined

    beforeEach(() => {
      prevVibeosHome = process.env.VIBEOS_HOME
      tmp = path.join(os.tmpdir(), `vibeos-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      fs.mkdirSync(tmp, { recursive: true })
      process.env.VIBEOS_HOME = tmp
    })

    afterEach(() => {
      if (prevVibeosHome === undefined) {
        delete process.env.VIBEOS_HOME
      } else {
        process.env.VIBEOS_HOME = prevVibeosHome
      }
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('loadProjectTree returns null when no project tree exists', () => {
      assert.equal(mod.loadProjectTree('some-fp'), null)
    })

    it('projectTreeDirective returns null when no project tree exists', () => {
      assert.equal(mod.projectTreeDirective('some-fp'), null)
    })

    it('recordProjectFact succeeds with valid inputs', () => {
      assert.equal(mod.recordProjectFact('fp1', 'my-project', 'auth', 'fact', 'uses JWT tokens'), true)
    })

    it('loadProjectTree returns tree after facts recorded', () => {
      mod.recordProjectFact('fp1', 'my-project', 'auth', 'fact', 'uses JWT tokens')
      mod.recordProjectFact('fp1', 'my-project', 'auth', 'decision', 'use RS256')
      mod.recordProjectFact('fp1', 'my-project', 'db', 'blocker', 'need migration tool')

      const tree = mod.loadProjectTree('fp1')
      assert.notEqual(tree, null)
      assert.equal(tree!.name, 'my-project')
      assert.ok(tree!.branches.auth)
      assert.equal(tree!.branches.auth.facts.length, 2)
      assert.ok(tree!.branches.db)
      assert.equal(tree!.branches.db.facts.length, 1)
    })

    it('projectTreeDirective returns formatted directive', () => {
      mod.recordProjectFact('fp1', 'my-project', 'auth', 'fact', 'uses JWT')
      const dir = mod.projectTreeDirective('fp1')
      assert.notEqual(dir, null)
      assert.ok(dir!.includes('[project knowledge: my-project]'))
      assert.ok(dir!.includes('uses JWT'))
    })

    it('projectTreeDirective respects maxBranches and maxFactsPerBranch', () => {
      for (let i = 0; i < 6; i++) {
        mod.recordProjectFact('fp1', 'proj', `branch-${i}`, 'fact', `fact-${i}`)
      }
      const dir = mod.projectTreeDirective('fp1', { maxBranches: 3, maxFactsPerBranch: 1 })
      assert.notEqual(dir, null)
      const branchCount = dir!.split('|').length
      assert.ok(branchCount <= 3)
    })

    it('projectTreeDirective returns null for empty tree', () => {
      mod.recordProjectFact('fp1', 'proj', 'main', 'fact', 'something')
      const tree = mod.loadProjectTree('fp2')
      assert.equal(tree, null)
      assert.equal(mod.projectTreeDirective('fp2'), null)
    })
  })
})
