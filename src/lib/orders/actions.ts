'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createChannel(input: { name: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('channels').insert({ name: input.name })
  if (error) return { error: error.message }
  revalidatePath('/channels')
}

export type OrderLineInput = { sku_id: string; qty: number; unit_price: number }

export async function createOrder(input: {
  channel_id: string; order_date: string; customer: string; notes: string; lines: OrderLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_order', {
    p_channel_id: input.channel_id,
    p_order_date: input.order_date || null,
    p_customer: input.customer,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/orders/${data}`)
}
