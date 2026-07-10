// Semantic badge colors + Bahasa labels, matching the design prototype.

export const STAGE_META: Record<string, { label: string; c: string; bg: string }> = {
  trial: { label: 'Trial', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  mass_production: { label: 'Mass Prod', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  qc: { label: 'QC', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  completed: { label: 'Selesai', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  canceled: { label: 'Batal', c: '#ff9b9b', bg: 'rgba(255,155,155,.13)' },
}

export const MOVEMENT_META: Record<string, { label: string; c: string; bg: string }> = {
  production_in: { label: 'Produksi Masuk', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  sale_out: { label: 'Penjualan', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  return_in: { label: 'Retur Masuk', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  adjustment: { label: 'Penyesuaian', c: '#cdc6b8', bg: 'rgba(205,198,184,.13)' },
  transfer_out: { label: 'Transfer Keluar', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  transfer_in: { label: 'Transfer Masuk', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
}

export const MATERIAL_MOVEMENT_META: Record<string, { label: string; c: string; bg: string }> = {
  purchase_in: { label: 'Pembelian Masuk', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  issue_out: { label: 'Keluar ke Vendor', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  adjustment: { label: 'Penyesuaian', c: '#cdc6b8', bg: 'rgba(205,198,184,.13)' },
  transfer_in: { label: 'Transfer Masuk', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  transfer_out: { label: 'Transfer Keluar', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
}

export const COST_LABELS: Record<string, string> = {
  material: 'Material',
  cmt: 'CMT (Jahit)',
  overhead: 'Overhead',
  other: 'Lainnya',
}

// Indonesian number formatting (dots as thousands separators).
export function rp(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('id-ID')
}
