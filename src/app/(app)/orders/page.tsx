import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase
    .from('orders').select('id, code, order_date, channel_id')
    .order('order_date', { ascending: false })
  const { data: channels } = await supabase.from('channels').select('id, name')
  const { data: lines } = await supabase.from('order_lines').select('order_id, qty, unit_price')
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]))
  const totalOf = new Map<string, number>()
  for (const l of lines ?? []) totalOf.set(l.order_id, (totalOf.get(l.order_id) ?? 0) + l.qty * Number(l.unit_price))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Orders</h1>
        <Link href="/orders/new" className="vb-btn" style={{ textDecoration: 'none' }}>New order</Link>
      </div>
      {!orders?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No orders yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Channel</th>
                <th style={{ padding: 12 }}>Date</th><th style={{ padding: 12 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/orders/${o.id}`} style={{ color: 'var(--vb-accent)' }}>{o.code}</Link></td>
                  <td style={{ padding: 12 }}>{channelName.get(o.channel_id) ?? '—'}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{o.order_date}</td>
                  <td style={{ padding: 12 }}>{(totalOf.get(o.id) ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
