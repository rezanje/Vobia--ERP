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
export const canViewCatalog = (role: string | null) =>
  role === 'owner' || role === 'production' || role === 'inventory' || role === 'ops' || role === 'finance'
