import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  _modelLocked,
  _lockedSlot,
  _lockedModel,
  setModelLocked,
  setLockedSlot,
  setLockedModel
} from '../../state.js'

test('initial state is unlocked', () => {
  assert.equal(_modelLocked, false)
  assert.equal(_lockedSlot, null)
  assert.equal(_lockedModel, null)
})

test('setModelLocked(true) freezes', () => {
  setModelLocked(true)
  assert.equal(_modelLocked, true)
})

test('setModelLocked(false) unfreezes', () => {
  setModelLocked(false)
  assert.equal(_modelLocked, false)
})

test('slot and model can be locked independently', () => {
  setLockedSlot('brain')
  setLockedModel('deepseek/deepseek-chat')
  assert.equal(_lockedSlot, 'brain')
  assert.equal(_lockedModel, 'deepseek/deepseek-chat')
  // Change slot only - model stays unchanged
  setLockedSlot('medium')
  assert.equal(_lockedSlot, 'medium')
  assert.equal(_lockedModel, 'deepseek/deepseek-chat')
})

test('lock state is in-memory only', () => {
  // Module-level variables have no file persistence.
  // Verify the lock variables are NOT in model-tiers.json
  const tiersPath = path.join(os.homedir(), '.claude', 'model-tiers.json')
  if (fs.existsSync(tiersPath)) {
    const content = JSON.parse(fs.readFileSync(tiersPath, 'utf8'))
    assert.equal(content._modelLocked, undefined)
    assert.equal(content._lockedSlot, undefined)
    assert.equal(content._lockedModel, undefined)
  }
  // Verify lock state is not in delegation-state.json either
  const delPath = path.join(os.homedir(), '.claude', 'delegation-state.json')
  if (fs.existsSync(delPath)) {
    const content = JSON.parse(fs.readFileSync(delPath, 'utf8'))
    assert.equal(content._modelLocked, undefined)
    assert.equal(content._lockedSlot, undefined)
    assert.equal(content._lockedModel, undefined)
  }
})
