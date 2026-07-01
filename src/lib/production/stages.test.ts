import { describe, it, expect } from 'vitest'
import { nextStages } from './stages'

describe('nextStages', () => {
  it('trial can go to mass_production or canceled', () => {
    expect(nextStages('trial')).toEqual(['mass_production', 'canceled'])
  })
  it('qc can complete, rework, or cancel', () => {
    expect(nextStages('qc')).toEqual(['completed', 'mass_production', 'canceled'])
  })
  it('terminal stages have no transitions', () => {
    expect(nextStages('completed')).toEqual([])
    expect(nextStages('canceled')).toEqual([])
  })
  it('unknown stage yields none', () => {
    expect(nextStages('bogus')).toEqual([])
  })
})
