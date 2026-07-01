'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ColorwayInput = { color_name: string; color_code: string }

export type CreateStyleInput = {
  code: string
  name: string
  collection: string
  colorways: ColorwayInput[]
  sizes: string[]
  overrides: Record<string, string>
}

export async function createStyle(input: CreateStyleInput): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_style_with_skus', {
    p_code: input.code,
    p_name: input.name,
    p_collection: input.collection,
    p_colorways: input.colorways,
    p_sizes: input.sizes,
    p_overrides: input.overrides,
  })
  if (error) return { error: error.message }
  redirect(`/styles/${data}`)
}

export async function toggleSku(id: string, active: boolean): Promise<void> {
  const supabase = await createClient()
  await supabase.from('skus').update({ active }).eq('id', id)
}
