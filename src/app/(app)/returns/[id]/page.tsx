import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: ret } = await supabase.from('returns').select('*').eq('id', id).single()
  if (!ret) notFound()

  const { data: order } = await supabase.from('orders').select('code').eq('id', ret.order_id).single()
  const { data: lines } = await supabase.from('return_lines').select('id, sku_id, qty').eq('return_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{ret.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>Order {order?.code ?? '—'} · {ret.return_date}{ret.reason ? ` · ${ret.reason}` : ''}</p>

      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(l.sku_id) ?? l.sku_id}</td>
                <td style={{ padding: 12 }}>{l.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
