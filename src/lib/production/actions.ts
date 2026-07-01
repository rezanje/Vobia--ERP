'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createVendor(input: { name: string; contact: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('vendors').insert({ name: input.name, contact: input.contact || null })
  if (error) return { error: error.message }
  revalidatePath('/vendors')
}

export type LineInput = { sku_id: string; qty_ordered: number }

export async function createProductionOrder(input: {
  style_id: string; vendor_id: string; deadline: string; notes: string; lines: LineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_production_order', {
    p_style_id: input.style_id,
    p_vendor_id: input.vendor_id,
    p_deadline: input.deadline || null,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/production/${data}`)
}

export async function updateProdLine(input: { id: string; qty_received: number; reject_count: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('prod_lines').update({ qty_received: input.qty_received, reject_count: input.reject_count }).eq('id', input.id)
  if (error) return { error: error.message }
  revalidatePath('/production')
}

export async function transitionStage(input: { po_id: string; next_stage: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('transition_production_stage', { p_po_id: input.po_id, p_next_stage: input.next_stage })
  if (error) return { error: error.message }
  revalidatePath('/production')
}
