import { describe, expect, test } from 'vitest'
import * as mod from '../vibemax'

describe('vibemax', () => {
  test('smoke: module loads', () => {
    expect(mod).toBeDefined()
  })

  test('exports the vibemax helpers', () => {
    expect(typeof mod.resetVibeMaXPipeline).toBe('function')
    expect(typeof mod.vibemaxSelectMode).toBe('function')
    expect(typeof mod.vibemaxPipeline).toBe('function')
    expect(typeof mod.predictVibeMaX).toBe('function')
    expect(typeof mod.trainVibeMaXModelFromTelemetry).toBe('function')
    expect(typeof mod.loadVibeMaXModel).toBe('function')
    expect(typeof mod.saveVibeMaXModel).toBe('function')
    expect(typeof mod.getVibeMaXModelMeta).toBe('function')
  })
})
