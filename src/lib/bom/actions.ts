'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addBomLine(input: {
  style_id: string; material_id: string; qty_per_unit: number
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('bom_lines').insert({
    style_id: input.style_id, material_id: input.material_id, qty_per_unit: input.qty_per_unit,
  })
  if (error) return { error: error.message }
  revalidatePath(`/styles/${input.style_id}`)
}

export async function removeBomLine(id: string, styleId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('bom_lines').delete().eq('id', id)
  revalidatePath(`/styles/${styleId}`)
}
