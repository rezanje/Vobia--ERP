'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type PcbLineInput = { style_id: string; target_sales: number; ending_stock: number; unit_cost: number }
export type PpoChildInput = {
  po_type: 'material' | 'finished' | 'sewing' | 'bordir' | 'accessory'
  vendor_id: string; amount: number; notes?: string
  material_id?: string; qty?: number; unit_price?: number
}

export async function createPcb(input: { projection_id: string; quarter: string; lines: PcbLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_pcb', {
    p_projection_id: input.projection_id, p_quarter: input.quarter, p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/pcb/${data}`)
}

export async function createPpo(input: { pcb_id: string; style_id: string; scheme: 'fob' | 'cmt'; qty: number; notes: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_ppo', {
    p_pcb_id: input.pcb_id, p_style_id: input.style_id, p_scheme: input.scheme, p_qty: input.qty, p_notes: input.notes,
  })
  if (error) return { error: error.message }
  redirect(`/ppo/${data}`)
}

export async function issuePpoPos(input: { ppo_id: string; children: PpoChildInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('issue_ppo_pos', { p_ppo_id: input.ppo_id, p_children: input.children })
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
  revalidatePath('/ppo')
  revalidatePath('/purchasing')
}

export async function addPoPayment(input: { ppo_id: string; po_id: string; kind: 'dp' | 'settlement' | 'full'; amount: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('po_payments').insert({ po_id: input.po_id, kind: input.kind, amount: input.amount })
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
}

export async function markPaymentPaid(input: { ppo_id: string; payment_id: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('po_payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', input.payment_id)
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
}
