'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function recordAdjustment(input: {
  sku_id: string
  qty: number
  reason: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_movement', {
    p_sku_id: input.sku_id,
    p_qty: input.qty,
    p_movement_type: 'adjustment',
    p_reason: input.reason,
  })
  if (error) return { error: error.message }
  revalidatePath('/stock')
}
