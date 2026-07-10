import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StageButtons from './StageButtons'
import ProdLineRow from './ProdLineRow'
import CostForm from './CostForm'
import IssueSection from './IssueSection'
import { suggestIssue } from '@/lib/bom/suggest'
import { COST_LABELS, rp } from '@/lib/ui'

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()

  const { data: lines } = await supabase.from('prod_lines').select('id, sku_id, qty_ordered, qty_received, reject_count').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  const { data: costs } = await supabase.from('cost_entries').select('id, cost_type, amount, note').eq('po_id', id)
  const totalCost = (costs ?? []).reduce((s, c) => s + Number(c.amount), 0)

  const { data: bomRows } = await supabase.from('bom_lines').select('material_id, qty_per_unit').eq('style_id', po.style_id)
  const bomMatIds = (bomRows ?? []).map((b) => b.material_id)
  const { data: bomMaterials } = await supabase.from('materials').select('id, code').in('id', bomMatIds.length ? bomMatIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: issueLocations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const bomCodeOf = new Map((bomMaterials ?? []).map((m) => [m.id, m.code]))
  const totalUnits = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered), 0)
  const suggestions = suggestIssue(
    (bomRows ?? []).map((b) => ({ material_id: b.material_id, qty_per_unit: Number(b.qty_per_unit) })),
    totalUnits,
  ).map((s) => ({ material_id: s.material_id, material_code: bomCodeOf.get(s.material_id) ?? s.material_id, qty: s.qty }))

  return (
    <div>
      <Link href="/production" className="vb-back">← Produksi</Link>
      <div style={{ marginBottom: 16 }}>
        <h1 className="vb-h1">{po.code}</h1>
        <div className="vb-sub">{po.deadline ? `Deadline ${po.deadline}` : 'Tanpa deadline'}{po.notes ? ` · ${po.notes}` : ''}</div>
      </div>

      <StageButtons poId={po.id} stage={po.stage} />

      <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Line Produksi</div>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.5fr 90px 110px 100px 90px' }}>
          <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Order</div><div>Diterima</div><div>Reject</div><div></div>
        </div>
        {(lines ?? []).map((l) => (
          <ProdLineRow key={l.id} id={l.id} sku_code={codeOf.get(l.sku_id) ?? l.sku_id}
            qty_ordered={l.qty_ordered} qty_received={l.qty_received} reject_count={l.reject_count} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Biaya Produksi</div>
          {costs?.length ? (
            <>
              <div className="vb-thead" style={{ gridTemplateColumns: '110px 1fr 130px' }}>
                <div>Tipe</div><div>Catatan</div><div style={{ textAlign: 'right' }}>Jumlah</div>
              </div>
              {costs.map((c) => (
                <div key={c.id} className="vb-row" style={{ gridTemplateColumns: '110px 1fr 130px' }}>
                  <div style={{ fontWeight: 500, fontSize: 12.5 }}>{COST_LABELS[c.cost_type] ?? c.cost_type}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{c.note ?? '—'}</div>
                  <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 500 }}>{rp(Number(c.amount))}</div>
                </div>
              ))}
              <div className="vb-row" style={{ gridTemplateColumns: '1fr 140px', borderTop: '1px solid var(--vb-border)' }}>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>Total</div>
                <div className="vb-mono vb-accent" style={{ textAlign: 'right', fontWeight: 600 }}>{rp(totalCost)}</div>
              </div>
            </>
          ) : (
            <div style={{ padding: '20px 16px', color: 'var(--vb-dim)', fontSize: 12.5 }}>Belum ada biaya tercatat.</div>
          )}
        </div>
        <CostForm poId={po.id} />
      </div>

      <IssueSection prodPoId={po.id} suggestions={suggestions} locations={issueLocations ?? []} />
    </div>
  )
}
