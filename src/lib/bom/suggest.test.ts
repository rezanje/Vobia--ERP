import { describe, it, expect } from 'vitest'
import { suggestIssue } from './suggest'

describe('suggestIssue', () => {
  it('multiplies qty_per_unit by total units per material', () => {
    const bom = [
      { material_id: 'a', qty_per_unit: 1.25 },
      { material_id: 'b', qty_per_unit: 0.5 },
    ]
    expect(suggestIssue(bom, 10)).toEqual([
      { material_id: 'a', qty: 12.5 },
      { material_id: 'b', qty: 5 },
    ])
  })

  it('returns empty for an empty BOM', () => {
    expect(suggestIssue([], 100)).toEqual([])
  })
})
