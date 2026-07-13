import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import EmployeeForm from './EmployeeForm'

export default async function EmployeesPage() {
  const supabase = await createClient()
  const { data: employees } = await supabase.from('employees').select('*').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Karyawan</h1>
        <div className="vb-sub">{employees?.length ?? 0} karyawan</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 1fr 140px 80px' }}>
            <div>Nama</div><div>Jabatan</div><div style={{ textAlign: 'right' }}>Gaji Pokok</div><div>Status</div>
          </div>
          {!employees?.length ? <div className="vb-empty">Belum ada karyawan.</div> : employees.map((e) => (
            <div key={e.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 1fr 140px 80px' }}>
              <div style={{ fontWeight: 500 }}>{e.name}<div className="vb-muted" style={{ fontSize: 11 }}>{e.placement ?? ''}</div></div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{e.position ?? '—'}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(Number(e.base_salary))}</div>
              <div><span className="vb-badge" style={e.active ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' } : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>{e.active ? 'Aktif' : 'Nonaktif'}</span></div>
            </div>
          ))}
        </div>
        <EmployeeForm />
      </div>
    </div>
  )
}
