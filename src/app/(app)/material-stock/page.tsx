import { createClient } from '@/lib/supabase/server'
import MaterialAdjustForm from './MaterialAdjustForm'
import { MATERIAL_MOVEMENT_META } from '@/lib/ui'

export default async function MaterialStockPage() {
  const supabase = await createClient()

  const { data: materials } = await supabase.from('materials').select('id, code, name').order('code')
  const { data: locations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const { data: byLoc } = await supabase.from('material_balances_by_location').select('material_id, location_id, balance')
  const { data: movements } = await supabase
    .from('material_ledger')
    .select('id, material_id, location_id, qty, movement_type, reason, created_at')
    .order('created_at', { ascending: false }).limit(20)

  const matOf = new Map((materials ?? []).map((m) => [m.id, `${m.code}`]))
  const locName = new Map((locations ?? []).map((l) => [l.id, l.name]))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Stok Bahan</h1>
        <div className="vb-sub">{byLoc?.length ?? 0} saldo bahan × lokasi</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.7fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Saldo per Lokasi</div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
            <div>Bahan</div><div>Lokasi</div><div style={{ textAlign: 'right' }}>Saldo</div>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {!byLoc?.length ? (
              <div className="vb-empty">Belum ada stok bahan.</div>
            ) : byLoc.map((b) => (
              <div key={`${b.material_id}-${b.location_id}`} className="vb-row" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{matOf.get(b.material_id ?? '') ?? b.material_id}</div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{locName.get(b.location_id ?? '') ?? '—'}</div>
                <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: (b.balance ?? 0) < 0 ? 'var(--vb-danger)' : 'var(--vb-text)' }}>{b.balance}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MaterialAdjustForm materials={materials ?? []} locations={locations ?? []} />
          <div className="vb-card" style={{ overflow: 'hidden' }}>
            <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Pergerakan Terakhir</div>
            <div className="vb-thead" style={{ gridTemplateColumns: '1.2fr 130px 70px 1fr 1.2fr' }}>
              <div>Bahan</div><div>Tipe</div><div style={{ textAlign: 'right' }}>Qty</div><div>Lokasi</div><div>Alasan</div>
            </div>
            {!movements?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : movements.map((m) => {
              const meta = MATERIAL_MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, c: 'var(--vb-muted)', bg: 'transparent' }
              return (
                <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '1.2fr 130px 70px 1fr 1.2fr' }}>
                  <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{matOf.get(m.material_id) ?? m.material_id}</div>
                  <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                  <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: Number(m.qty) < 0 ? 'var(--vb-danger)' : '#93d6a1' }}>{m.qty}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{locName.get(m.location_id ?? '') ?? '—'}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{m.reason ?? '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
