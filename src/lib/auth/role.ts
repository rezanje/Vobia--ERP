import { createClient } from '@/lib/supabase/server'

// Current user's app role from their profile
// (owner/sales/ops/production/inventory/finance/viewer).
export async function getRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return data?.role ?? null
}

export const canApprove = (role: string | null) => role === 'owner' || role === 'ops'

// P1-P3 planning/PPIC role gates (Sales vs Ops demo simulation).
export const canWriteSalesForecast = (role: string | null) => role === 'owner' || role === 'sales'
export const canWriteOpsForecast = (role: string | null) => role === 'owner' || role === 'ops'
export const canWritePpic = (role: string | null) => role === 'owner' || role === 'ops'
export const canViewPpic = (role: string | null) => role === 'owner' || role === 'ops'

// Catalog (Styles/Bahan/BOM) role gates.
export const canWriteCatalog = (role: string | null) => role === 'owner' || role === 'production' || role === 'inventory'

// Produksi role gates.
export const canWriteProduction = (role: string | null) => role === 'owner' || role === 'production'
export const canWriteVendor = (role: string | null) => role === 'owner' || role === 'production' || role === 'ops'
export const canWriteCost = (role: string | null) => role === 'owner' || role === 'production' || role === 'inventory'

// Penjualan (Order/Channel/Retur) role gate.
export const canWriteSales = (role: string | null) => role === 'owner' || role === 'sales'

// Lokasi (Pengaturan) role gate.
export const canWriteLocation = (role: string | null) => role === 'owner' || role === 'ops'

// Pembelian role gate.
export const canWritePurchasing = (role: string | null) => role === 'owner' || role === 'ops' || role === 'inventory'
