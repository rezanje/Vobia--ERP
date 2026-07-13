import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import PayComponentForm from './PayComponentForm'

export default async function PayComponentsPage() {
  const supabase = await createClient()
  const { data: comps } = await supabase.from('pay_components').select('*').order('kind').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Komponen Gaji</h1>
        <div className="vb-sub">Tunjangan & potongan yang dipakai saat proses gaji</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 110px 140px' }}>
            <div>Nama</div><div>Jenis</div><div style={{ textAlign: 'right' }}>Nilai</div>
          </div>
          {!comps?.length ? <div className="vb-empty">Belum ada komponen.</div> : comps.map((c) => (
            <div key={c.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 110px 140px' }}>
              <div style={{ fontWeight: 500 }}>{c.name}{c.is_tax ? <span className="vb-muted" style={{ fontSize: 11 }}> · pajak</span> : null}</div>
              <div><span className="vb-badge" style={c.kind === 'tunjangan' ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' } : { background: 'rgba(237,160,106,.13)', color: '#eda06a' }}>{c.kind === 'tunjangan' ? 'Tunjangan' : 'Potongan'}</span></div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{c.calc === 'persen' ? `${c.value}%` : rp(Number(c.value))}</div>
            </div>
          ))}
        </div>
        <PayComponentForm />
      </div>
    </div>
  )
}
