import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteVendor } from '@/lib/auth/role'
import VendorForm from './VendorForm'

export default async function VendorsPage() {
  const supabase = await createClient()
  const canWrite = canWriteVendor(await getRole())
  const { data: vendors } = await supabase.from('vendors').select('id, name, contact, active').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Vendor</h1>
        <div className="vb-sub">{vendors?.length ?? 0} vendor terdaftar</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 1.4fr 100px' }}>
            <div>Nama</div><div>Kontak</div><div>Status</div>
          </div>
          {!vendors?.length ? (
            <div className="vb-empty">Belum ada vendor.</div>
          ) : vendors.map((v) => (
            <div key={v.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 1.4fr 100px' }}>
              <div style={{ fontWeight: 500 }}>{v.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{v.contact ?? '—'}</div>
              <div>
                <span className="vb-badge" style={v.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {v.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        {canWrite ? <VendorForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Vendor Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Produksi/Ops/Owner yang bisa menambah vendor.</div>
          </div>
        )}
      </div>
    </div>
  )
}
