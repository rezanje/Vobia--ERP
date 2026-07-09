export type OpnameBalance = { sku_id: string; balance: number }
export type OpnameCount = { sku_id: string; counted: number }
export type OpnameDelta = { sku_id: string; delta: number }

// Physical count minus system balance, per sku. Only non-zero deltas are
// returned — an sku counted equal to its balance needs no adjustment.
export function computeOpnameDeltas(
  counts: OpnameCount[],
  balances: OpnameBalance[],
): OpnameDelta[] {
  const balanceOf = new Map(balances.map((b) => [b.sku_id, b.balance]))
  return counts
    .map((c) => ({ sku_id: c.sku_id, delta: c.counted - (balanceOf.get(c.sku_id) ?? 0) }))
    .filter((d) => d.delta !== 0)
}
