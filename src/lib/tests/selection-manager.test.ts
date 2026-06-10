import { describe, expect, test } from 'vitest'
import * as mod from '../selection-manager'

describe('selection-manager', () => {
  test('smoke: module loads', () => {
    expect(mod).toBeDefined()
  })

  test('exports the selection helpers', () => {
    expect(typeof mod.loadSelection).toBe('function')
    expect(typeof mod.writeSelection).toBe('function')
    expect(typeof mod.loadSessionSlot).toBe('function')
    expect(typeof mod.writeSessionSlot).toBe('function')
    expect(typeof mod.loadSessionOptMode).toBe('function')
    expect(typeof mod.loadGlobalOptMode).toBe('function')
    expect(typeof mod.saveGlobalOptMode).toBe('function')
    expect(typeof mod.writeSessionOptMode).toBe('function')
  })
})
