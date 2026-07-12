import { createClient } from '@/lib/supabase/server'

// Current user's app role from their profile
// (owner/ops/production/inventory/finance/viewer).
export async function getRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return data?.role ?? null
}

export const canApprove = (role: string | null) => role === 'owner' || role === 'ops'
