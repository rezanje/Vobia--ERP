'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createLocation(input: { name: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('locations').insert({ name: input.name })
  if (error) return { error: error.message }
  revalidatePath('/locations')
}
