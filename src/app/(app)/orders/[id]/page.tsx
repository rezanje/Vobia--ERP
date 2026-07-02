import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase.from('orders').select('*').eq('id', id).single()
  if (!order) notFound()

  const { data: channel } = await supabase.from('channels').select('name').eq('id', order.channel_id).single()
  const { data: lines } = await supabase.from('order_lines').select('id, sku_id, qty, unit_price').eq('order_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))
  const total = (lines ?? []).reduce((s, l) => s + l.qty * Number(l.unit_price), 0)

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{order.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{channel?.name ?? '—'} · {order.order_date}{order.customer ? ` · ${order.customer}` : ''}</p>

      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Qty</th>
              <th style={{ padding: 12 }}>Unit price</th><th style={{ padding: 12 }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(l.sku_id) ?? l.sku_id}</td>
                <td style={{ padding: 12 }}>{l.qty}</td>
                <td style={{ padding: 12 }}>{Number(l.unit_price).toLocaleString()}</td>
                <td style={{ padding: 12 }}>{(l.qty * Number(l.unit_price)).toLocaleString()}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--vb-border)' }}>
              <td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>Total</td>
              <td style={{ padding: 12, fontWeight: 500 }}>{total.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
