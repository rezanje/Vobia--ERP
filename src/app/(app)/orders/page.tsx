import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

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
      <div className="vb-pagehead">
        <div>
          <h1 className="vb-h1">Order</h1>
          <div className="vb-sub">{orders?.length ?? 0} order tercatat</div>
        </div>
        <Link href="/orders/new" className="vb-btn">+ Order Baru</Link>
      </div>
      {!orders?.length ? (
        <div className="vb-empty">Belum ada order.</div>
      ) : (
        <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 900 }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '140px 1.2fr 120px 140px' }}>
            <div>Kode</div><div>Channel</div><div>Tanggal</div><div style={{ textAlign: 'right' }}>Total</div>
          </div>
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '140px 1.2fr 120px 140px', textDecoration: 'none', color: 'inherit' }}>
              <div className="vb-mono vb-accent" style={{ fontWeight: 500 }}>{o.code}</div>
              <div>{channelName.get(o.channel_id) ?? '—'}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{o.order_date}</div>
              <div className="vb-mono" style={{ fontWeight: 500, textAlign: 'right' }}>{rp(totalOf.get(o.id) ?? 0)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
