import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import PayslipRow from './PayslipRow'
import PostButton from './PostButton'

export default async function PayrollDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: run } = await supabase.from('payroll_runs').select('*').eq('id', id).single()
  if (!run) notFound()
  const draft = run.status === 'draft'

  const { data: slips } = await supabase.from('payslips').select('*').eq('run_id', id)
  const empIds = (slips ?? []).map((s) => s.employee_id)
  const { data: emps } = await supabase.from('employees').select('id, name').in('id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000'])
  const nameOf = new Map((emps ?? []).map((e) => [e.id, e.name]))
  const rows = (slips ?? []).map((s) => ({ ...s, name: nameOf.get(s.employee_id) ?? s.employee_id })).sort((a, b) => a.name.localeCompare(b.name))
  const totalNet = rows.reduce((t, r) => t + Number(r.net), 0)

  return (
    <div>
      <Link href="/payroll" className="vb-back">← Proses Gaji</Link>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="vb-h1">Gaji {run.period}
            <span className="vb-badge" style={{ marginLeft: 8, ...(draft ? { background: 'rgba(227,196,110,.13)', color: '#e3c46e' } : { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }) }}>{draft ? 'Draft' : 'Diposting'}</span>
          </h1>
          <div className="vb-sub">{rows.length} karyawan · total bersih {rp(totalNet)}</div>
        </div>
        {draft && <PostButton runId={run.id} />}
      </div>

      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.3fr 110px 110px 100px 100px 120px 60px' }}>
          <div>Karyawan</div>
          <div style={{ textAlign: 'right' }}>Pokok</div>
          <div style={{ textAlign: 'right' }}>Tunjangan</div>
          <div style={{ textAlign: 'right' }}>Lembur</div>
          <div style={{ textAlign: 'right' }}>Potongan</div>
          <div style={{ textAlign: 'right' }}>Bersih</div>
          <div></div>
        </div>
        {rows.map((r) => (
          <PayslipRow key={r.id} slip={{
            id: r.id, run_id: id, name: r.name, base: Number(r.base_salary), tunjangan: Number(r.tunjangan_total),
            overtime: Number(r.overtime), potongan: Number(r.deduction_total) + Number(r.tax_total), net: Number(r.net),
          }} editable={draft} />
        ))}
      </div>
    </div>
  )
}
