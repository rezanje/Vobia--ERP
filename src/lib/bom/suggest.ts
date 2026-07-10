export type BomLine = { material_id: string; qty_per_unit: number }
export type IssueSuggestion = { material_id: string; qty: number }

// Suggested issue quantity per material = qty_per_unit * total units on the
// production order. Caller can edit before issuing.
export function suggestIssue(bom: BomLine[], totalUnits: number): IssueSuggestion[] {
  return bom.map((b) => ({ material_id: b.material_id, qty: b.qty_per_unit * totalUnits }))
}
