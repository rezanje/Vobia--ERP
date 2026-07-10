'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type PurchaseLineInput = { material_id: string; qty_ordered: number; unit_price: number }

export async function createPurchaseOrder(input: {
  vendor_id: string; location_id?: string; order_date?: string; notes: string; lines: PurchaseLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_vendor_id: input.vendor_id,
    p_location_id: input.location_id ?? null,
    p_order_date: input.order_date ?? null,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/purchasing/${data}`)
}

export async function receivePurchase(input: {
  po_id: string; receipts: { line_id: string; qty: number }[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('receive_purchase', { p_po_id: input.po_id, p_receipts: input.receipts })
  if (error) return { error: error.message }
  revalidatePath(`/purchasing/${input.po_id}`)
}
