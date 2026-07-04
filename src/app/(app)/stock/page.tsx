import { createClient } from '@/lib/supabase/server'
import AdjustForm from './AdjustForm'
import { MOVEMENT_META, rp } from '@/lib/ui'

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
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Stok</h1>
        <div className="vb-sub">{balances?.length ?? 0} SKU tercatat</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.7fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Saldo SKU</div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 90px' }}>
            <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Saldo</div>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {!balances?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : balances.map((b) => (
              <div key={b.sku_id} className="vb-row" style={{ gridTemplateColumns: '1fr 90px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{codeOf.get(b.sku_id ?? '') ?? b.sku_id}</div>
                <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: (b.balance ?? 0) < 0 ? 'var(--vb-danger)' : 'var(--vb-text)' }}>{b.balance}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AdjustForm skus={skus ?? []} />
          <div className="vb-card" style={{ overflow: 'hidden' }}>
            <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Pergerakan Terakhir</div>
            <div className="vb-thead" style={{ gridTemplateColumns: '1.3fr 130px 60px 1.4fr' }}>
              <div>Kode SKU</div><div>Tipe</div><div style={{ textAlign: 'right' }}>Qty</div><div>Alasan</div>
            </div>
            {!movements?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : movements.map((m) => {
              const meta = MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, c: 'var(--vb-muted)', bg: 'transparent' }
              return (
                <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '1.3fr 130px 60px 1.4fr' }}>
                  <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{codeOf.get(m.sku_id) ?? m.sku_id}</div>
                  <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                  <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: m.qty < 0 ? 'var(--vb-danger)' : '#93d6a1' }}>{rp(m.qty)}</div>
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
