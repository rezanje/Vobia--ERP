'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createEmployee(input: {
  name: string; position: string; placement: string; base_salary: number; join_date: string; bank_account: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('employees').insert({
    name: input.name, position: input.position || null, placement: input.placement || null,
    base_salary: input.base_salary, join_date: input.join_date || null, bank_account: input.bank_account || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/employees')
}

export async function createPayComponent(input: {
  name: string; kind: string; calc: string; value: number; is_tax: boolean
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('pay_components').insert({
    name: input.name, kind: input.kind, calc: input.calc, value: input.value, is_tax: input.is_tax,
  })
  if (error) return { error: error.message }
  revalidatePath('/pay-components')
}

export async function generatePayroll(period: string): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generate_payroll', { p_period: period })
  if (error) return { error: error.message }
  revalidatePath('/payroll')
  return { id: data as string }
}

export async function setOvertime(input: { payslip_id: string; run_id: string; overtime: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data: run } = await supabase.from('payroll_runs').select('status').eq('id', input.run_id).single()
  if (run?.status !== 'draft') return { error: 'Proses gaji sudah diposting' }
  const { error } = await supabase.from('payslips').update({ overtime: input.overtime }).eq('id', input.payslip_id)
  if (error) return { error: error.message }
  revalidatePath(`/payroll/${input.run_id}`)
}

export async function postPayroll(run_id: string): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('post_payroll', { p_run_id: run_id })
  if (error) return { error: error.message }
  revalidatePath(`/payroll/${run_id}`)
  revalidatePath('/payroll')
}
