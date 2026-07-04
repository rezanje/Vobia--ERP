import Link from 'next/link'
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
      <Link href="/returns" className="vb-back">← Retur</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">{ret.code}</h1>
        <div className="vb-sub">Order {order?.code ?? '—'} · {ret.return_date}{ret.reason ? ` · ${ret.reason}` : ''}</div>
      </div>

      <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 560 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1fr 90px' }}>
          <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Qty</div>
        </div>
        {(lines ?? []).map((l) => (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1fr 90px' }}>
            <div className="vb-mono" style={{ fontWeight: 500 }}>{codeOf.get(l.sku_id) ?? l.sku_id}</div>
            <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600 }}>{l.qty}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
