'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ReturnLineInput = { sku_id: string; qty: number }

export async function createReturn(input: {
  order_id: string; return_date: string; reason: string; notes: string; lines: ReturnLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_return', {
    p_order_id: input.order_id,
    p_return_date: input.return_date || null,
    p_reason: input.reason,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/returns/${data}`)
}
