import { createClient } from '@/lib/supabase/server'

export default async function CostingPage() {
  const supabase = await createClient()
  const { data: hpp } = await supabase.from('sku_hpp').select('sku_id, hpp, costed_units')
  const { data: skus } = await supabase.from('skus').select('id, sku_code')
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Costing (HPP)</h1>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>HPP</th><th style={{ padding: 12 }}>Costed units</th>
            </tr>
          </thead>
          <tbody>
            {!hpp?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>No costed SKUs yet.</td></tr>
            ) : hpp.map((h) => (
              <tr key={h.sku_id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(h.sku_id ?? '') ?? h.sku_id}</td>
                <td style={{ padding: 12 }}>{h.hpp === null ? '—' : Number(h.hpp).toLocaleString()}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{h.costed_units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
