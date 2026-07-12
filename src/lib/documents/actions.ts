'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// DB enforces role (owner/ops) + tenant; UI hides the button. This stays thin.
export async function approveDocument(input: { kind: 'production' | 'purchase'; id: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('approve_document', { p_kind: input.kind, p_id: input.id })
  if (error) return { error: error.message }
  const base = input.kind === 'production' ? '/production' : '/purchasing'
  revalidatePath(`${base}/${input.id}`)
  revalidatePath(base)
}
