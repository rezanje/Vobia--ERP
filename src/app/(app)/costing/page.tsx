import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

export default async function CostingPage() {
  const supabase = await createClient()
  const { data: hpp } = await supabase.from('sku_hpp').select('sku_id, hpp, costed_units')
  const { data: skus } = await supabase.from('skus').select('id, sku_code')
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">HPP / Costing</h1>
        <div className="vb-sub">{hpp?.length ?? 0} SKU sudah ter-costing</div>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 720 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.5fr 150px 120px' }}>
          <div>Kode SKU</div><div style={{ textAlign: 'right' }}>HPP</div><div style={{ textAlign: 'right' }}>Unit Costed</div>
        </div>
        <div style={{ maxHeight: 600, overflowY: 'auto' }}>
          {!hpp?.length ? (
            <div className="vb-empty">Belum ada SKU yang ter-costing.</div>
          ) : hpp.map((h) => (
            <div key={h.sku_id} className="vb-row" style={{ gridTemplateColumns: '1.5fr 150px 120px' }}>
              <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{codeOf.get(h.sku_id ?? '') ?? h.sku_id}</div>
              <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 500, color: h.hpp === null ? 'var(--vb-muted)' : 'var(--vb-text)' }}>{h.hpp === null ? '—' : rp(Number(h.hpp))}</div>
              <div className="vb-mono vb-muted" style={{ textAlign: 'right' }}>{h.costed_units}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
