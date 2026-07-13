'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createAccount(input: {
  code: string; name: string; type: string; normal_balance: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('accounts').insert({
    code: input.code, name: input.name, type: input.type, normal_balance: input.normal_balance,
  })
  if (error) return { error: error.message }
  revalidatePath('/accounts')
}

export async function postManualJournal(input: {
  date: string; memo: string; lines: { account_code: string; debit: number; credit: number }[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('post_journal', {
    p_date: input.date || null,
    p_memo: input.memo || null,
    p_source_type: null,
    p_source_id: null,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  revalidatePath('/journals')
}

export async function postOpeningBalance(): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('post_opening_balance', {})
  if (error) return { error: error.message }
  revalidatePath('/journals')
}
