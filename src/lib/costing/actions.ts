'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addCostEntry(input: { po_id: string; cost_type: string; amount: number; note: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('cost_entries').insert({
    po_id: input.po_id, cost_type: input.cost_type, amount: input.amount, note: input.note || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/production/${input.po_id}`)
  revalidatePath('/costing')
}
