'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function issueMaterialToPo(input: {
  prod_po_id: string; issues: { material_id: string; qty: number }[]; location_id?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('issue_material_to_po', {
    p_prod_po_id: input.prod_po_id,
    p_issues: input.issues,
    p_location_id: input.location_id ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/production/${input.prod_po_id}`)
}
