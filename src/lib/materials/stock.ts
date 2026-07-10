'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function recordMaterialAdjustment(input: {
  material_id: string; qty: number; reason: string; location_id?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_material_movement', {
    p_material_id: input.material_id,
    p_qty: input.qty,
    p_movement_type: 'adjustment',
    p_reason: input.reason,
    p_location_id: input.location_id ?? undefined,
  })
  if (error) return { error: error.message }
  revalidatePath('/material-stock')
}
