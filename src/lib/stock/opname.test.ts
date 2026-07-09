import { describe, it, expect } from 'vitest'
import { computeOpnameDeltas } from './opname'

describe('computeOpnameDeltas', () => {
  it('returns counted minus balance for changed skus only', () => {
    const balances = [
      { sku_id: 'a', balance: 10 },
      { sku_id: 'b', balance: 5 },
      { sku_id: 'c', balance: 0 },
    ]
    const counts = [
      { sku_id: 'a', counted: 8 },   // -2
      { sku_id: 'b', counted: 5 },   // unchanged -> dropped
      { sku_id: 'c', counted: 3 },   // +3 (no prior balance row)
    ]
    expect(computeOpnameDeltas(counts, balances)).toEqual([
      { sku_id: 'a', delta: -2 },
      { sku_id: 'c', delta: 3 },
    ])
  })

  it('treats a missing balance as zero', () => {
    expect(computeOpnameDeltas([{ sku_id: 'x', counted: 4 }], [])).toEqual([
      { sku_id: 'x', delta: 4 },
    ])
  })
})
