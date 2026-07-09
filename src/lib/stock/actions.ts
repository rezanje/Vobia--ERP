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

export async function recordTransfer(input: {
  sku_id: string; qty: number; from_location: string; to_location: string; reason?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_transfer', {
    p_sku_id: input.sku_id,
    p_qty: input.qty,
    p_from_location: input.from_location,
    p_to_location: input.to_location,
    p_reason: input.reason ?? undefined,
  })
  if (error) return { error: error.message }
  revalidatePath('/stock')
}

export async function postOpname(input: {
  location_id: string; deltas: { sku_id: string; delta: number }[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  for (const d of input.deltas) {
    const { error } = await supabase.rpc('record_movement', {
      p_sku_id: d.sku_id,
      p_qty: d.delta,
      p_movement_type: 'adjustment',
      p_reason: 'opname',
      p_location_id: input.location_id,
    })
    if (error) return { error: error.message }
  }
  revalidatePath('/stock')
}
