import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import GenerateForm from './GenerateForm'

export default async function PayrollPage() {
  const supabase = await createClient()
  const { data: runs } = await supabase.from('payroll_runs').select('*').order('period', { ascending: false })
  const ids = (runs ?? []).map((r) => r.id)
  const { data: slips } = await supabase.from('payslips').select('run_id, net')
    .in('run_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const totalOf = new Map<string, number>()
  for (const s of slips ?? []) totalOf.set(s.run_id, (totalOf.get(s.run_id) ?? 0) + Number(s.net))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Proses Gaji</h1>
        <div className="vb-sub">{runs?.length ?? 0} periode</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '120px 150px 1fr' }}>
            <div>Periode</div><div>Status</div><div style={{ textAlign: 'right' }}>Total Gaji Bersih</div>
          </div>
          {!runs?.length ? <div className="vb-empty">Belum ada proses gaji.</div> : runs.map((r) => (
            <Link key={r.id} href={`/payroll/${r.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '120px 150px 1fr' }}>
              <div className="vb-mono" style={{ fontWeight: 500 }}>{r.period}</div>
              <div><span className="vb-badge" style={r.status === 'posted' ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' } : { background: 'rgba(227,196,110,.13)', color: '#e3c46e' }}>{r.status === 'posted' ? 'Diposting' : 'Draft'}</span></div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(totalOf.get(r.id) ?? 0)}</div>
            </Link>
          ))}
        </div>
        <GenerateForm />
      </div>
    </div>
  )
}
