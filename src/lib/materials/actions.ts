'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createMaterial(input: {
  code: string; name: string; category: string; uom: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('materials').insert({
    code: input.code, name: input.name, category: input.category, uom: input.uom,
  })
  if (error) return { error: error.message }
  revalidatePath('/materials')
}

export async function toggleMaterial(id: string, active: boolean): Promise<void> {
  const supabase = await createClient()
  await supabase.from('materials').update({ active }).eq('id', id)
  revalidatePath('/materials')
}
