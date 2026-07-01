import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StageButtons from './StageButtons'
import ProdLineRow from './ProdLineRow'

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()

  const { data: lines } = await supabase.from('prod_lines').select('id, sku_id, qty_ordered, qty_received, reject_count').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{po.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{po.deadline ? `Deadline ${po.deadline}` : 'No deadline'}{po.notes ? ` · ${po.notes}` : ''}</p>

      <StageButtons poId={po.id} stage={po.stage} />

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines (edit received/rejects, then transition to completed to post stock)</div>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Ordered</th>
              <th style={{ padding: 12 }}>Received</th><th style={{ padding: 12 }}>Rejects</th><th style={{ padding: 12 }}></th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <ProdLineRow key={l.id} id={l.id} sku_code={codeOf.get(l.sku_id) ?? l.sku_id}
                qty_ordered={l.qty_ordered} qty_received={l.qty_received} reject_count={l.reject_count} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
