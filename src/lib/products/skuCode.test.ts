import { describe, it, expect } from 'vitest'
import { buildSkuCode, overrideKey, resolveSkuCode } from './skuCode'

describe('skuCode', () => {
  it('builds auto code from parts', () => {
    expect(buildSkuCode('VB-MIRA', 'BLK', 'M')).toBe('VB-MIRA-BLK-M')
  })
  it('keys overrides by colorCode-size', () => {
    expect(overrideKey('BLK', 'S')).toBe('BLK-S')
  })
  it('uses override when present, else auto', () => {
    const ov = { 'BLK-S': 'CUSTOM' }
    expect(resolveSkuCode('VB-MIRA', 'BLK', 'S', ov)).toBe('CUSTOM')
    expect(resolveSkuCode('VB-MIRA', 'BLK', 'M', ov)).toBe('VB-MIRA-BLK-M')
  })
})
