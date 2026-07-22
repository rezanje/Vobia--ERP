'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ForecastLineInput = { style_id: string; qty: number; ito?: number | null; stock_ratio?: number | null }
export type ProjectionLineInput = { style_id: string; qty: number; kind: 'regular' | 'seasonal_new'; new_product_id?: string | null }

export async function createForecast(input: { kind: 'sales' | 'ops'; period: string; notes: string; lines: ForecastLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_forecast', {
    p_kind: input.kind, p_period: input.period, p_notes: input.notes, p_lines: input.lines,
  })
  if (error) return { error: error.message }
  revalidatePath('/forecasts')
  revalidatePath('/projections')
}

export async function createProjection(input: { period: string; lines: ProjectionLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_projection', { p_period: input.period, p_lines: input.lines })
  if (error) return { error: error.message }
  redirect(`/projections/${data}`)
}

export async function lockProjection(id: string): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('lock_projection', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/projections/${id}`)
  revalidatePath('/projections')
}

export type DemandLineInput = { sku_id: string; month: string; qty: number }

export async function setDemandPlan(lines: DemandLineInput[]): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_demand_plan', { p_lines: lines })
  if (error) return { error: error.message }
  revalidatePath('/stock-projection')
}

export async function seedDemandPlan(from: string, months: number): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('seed_demand_plan', { p_from: from, p_months: months })
  if (error) return { error: error.message }
  revalidatePath('/stock-projection')
}

export async function setPlanningParams(input: { cover_months: number; selling_days: number; net_rate: number; lead_time_months: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_planning_params', {
    p_cover_months: input.cover_months, p_selling_days: input.selling_days, p_net_rate: input.net_rate,
    p_lead_time_months: input.lead_time_months,
  })
  if (error) return { error: error.message }
  revalidatePath('/stock-projection')
}

export async function createNewProduct(input: { name: string; style_id?: string; notes: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('new_products').insert({
    name: input.name, style_id: input.style_id || null, notes: input.notes || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/new-products')
}

export async function updateNewProduct(input: { id: string; rnd_status: string; mkt_status: string; agreed_qty: number | null }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('new_products').update({
    rnd_status: input.rnd_status, mkt_status: input.mkt_status, agreed_qty: input.agreed_qty,
  }).eq('id', input.id)
  if (error) return { error: error.message }
  revalidatePath('/new-products')
  revalidatePath('/projections')
}
