import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteLocation } from '@/lib/auth/role'
import LocationForm from './LocationForm'

export default async function LocationsPage() {
  const supabase = await createClient()
  const canWrite = canWriteLocation(await getRole())
  const { data: locations } = await supabase
    .from('locations').select('id, name, is_default, active').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Lokasi</h1>
        <div className="vb-sub">{locations?.length ?? 0} lokasi terdaftar</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 100px 100px' }}>
            <div>Nama</div><div>Default</div><div>Status</div>
          </div>
          {!locations?.length ? (
            <div className="vb-empty">Belum ada lokasi.</div>
          ) : locations.map((l) => (
            <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 100px 100px' }}>
              <div style={{ fontWeight: 500 }}>{l.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{l.is_default ? 'Ya' : '—'}</div>
              <div>
                <span className="vb-badge" style={l.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {l.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        {canWrite ? <LocationForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Lokasi Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Ops/Owner yang bisa menambah lokasi.</div>
          </div>
        )}
      </div>
    </div>
  )
}
