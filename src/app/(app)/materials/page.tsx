import { createClient } from '@/lib/supabase/server'
import MaterialForm from './MaterialForm'

const CAT_LABEL: Record<string, string> = { fabric: 'Kain', trim: 'Trim', accessory: 'Aksesoris', other: 'Lainnya' }

export default async function MaterialsPage() {
  const supabase = await createClient()
  const { data: materials } = await supabase
    .from('materials').select('id, code, name, category, uom, active').order('code')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Bahan</h1>
        <div className="vb-sub">{materials?.length ?? 0} bahan terdaftar</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '0.9fr 1.6fr 0.9fr 0.6fr 90px' }}>
            <div>Kode</div><div>Nama</div><div>Kategori</div><div>Satuan</div><div>Status</div>
          </div>
          {!materials?.length ? (
            <div className="vb-empty">Belum ada bahan.</div>
          ) : materials.map((m) => (
            <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '0.9fr 1.6fr 0.9fr 0.6fr 90px' }}>
              <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{m.code}</div>
              <div style={{ fontWeight: 500 }}>{m.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{CAT_LABEL[m.category] ?? m.category}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{m.uom}</div>
              <div>
                <span className="vb-badge" style={m.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {m.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <MaterialForm />
      </div>
    </div>
  )
}
