import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

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
      <Link href="/orders" className="vb-back">← Order</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">{order.code}</h1>
        <div className="vb-sub">{channel?.name ?? '—'} · {order.order_date}{order.customer ? ` · ${order.customer}` : ''}</div>
      </div>

      <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 760 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.5fr 70px 140px 140px' }}>
          <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Qty</div><div style={{ textAlign: 'right' }}>Harga</div><div style={{ textAlign: 'right' }}>Subtotal</div>
        </div>
        {(lines ?? []).map((l) => (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.5fr 70px 140px 140px' }}>
            <div className="vb-mono" style={{ fontWeight: 500 }}>{codeOf.get(l.sku_id) ?? l.sku_id}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{l.qty}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(Number(l.unit_price))}</div>
            <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 500 }}>{rp(l.qty * Number(l.unit_price))}</div>
          </div>
        ))}
        <div className="vb-row" style={{ gridTemplateColumns: '1fr 160px', borderTop: '1px solid var(--vb-border)' }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>Total</div>
          <div className="vb-mono vb-accent" style={{ textAlign: 'right', fontWeight: 600, fontSize: 15 }}>{rp(total)}</div>
        </div>
      </div>
    </div>
  )
}
