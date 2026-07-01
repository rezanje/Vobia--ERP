import { createClient } from '@/lib/supabase/server'
import AdjustForm from './AdjustForm'

export default async function StockPage() {
  const supabase = await createClient()

  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  const { data: balances } = await supabase.from('stock_balances').select('sku_id, balance')
  const { data: movements } = await supabase
    .from('stock_ledger')
    .select('id, sku_id, qty, movement_type, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Stock</h1>

      <AdjustForm skus={skus ?? []} />

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Balances</div>
      <div className="vb-card" style={{ marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {!balances?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={2}>No movements yet.</td></tr>
            ) : balances.map((b) => (
              <tr key={b.sku_id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{codeOf.get(b.sku_id ?? '') ?? b.sku_id}</td>
                <td style={{ padding: 12, color: (b.balance ?? 0) < 0 ? '#ff9b9b' : 'var(--vb-text)' }}>{b.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Recent movements</div>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Type</th>
              <th style={{ padding: 12 }}>Qty</th><th style={{ padding: 12 }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {!movements?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={4}>No movements yet.</td></tr>
            ) : movements.map((m) => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{codeOf.get(m.sku_id) ?? m.sku_id}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{m.movement_type}</td>
                <td style={{ padding: 12 }}>{m.qty}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
