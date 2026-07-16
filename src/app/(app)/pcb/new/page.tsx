import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PcbForm from './PcbForm'

export default async function PcbNewPage({ searchParams }: { searchParams: Promise<{ projection?: string }> }) {
  const { projection: projectionId } = await searchParams
  const supabase = await createClient()

  if (!projectionId) {
    return (
      <div>
        <Link href="/projections" className="vb-back">← Proyeksi</Link>
        <div className="vb-empty">Pilih proyeksi yang sudah terkunci terlebih dahulu.</div>
      </div>
    )
  }

  const { data: projection } = await supabase.from('projections').select('*').eq('id', projectionId).single()

  if (!projection) {
    return (
      <div>
        <Link href="/projections" className="vb-back">← Proyeksi</Link>
        <div className="vb-empty">Proyeksi tidak ditemukan.</div>
      </div>
    )
  }

  if (projection.status !== 'locked') {
    return (
      <div>
        <Link href={`/projections/${projection.id}`} className="vb-back">← Proyeksi</Link>
        <div className="vb-empty">Proyeksi ini belum terkunci. Kunci proyeksi dulu sebelum membuat PCB.</div>
      </div>
    )
  }

  const { data: lines } = await supabase
    .from('projection_lines')
    .select('id, style_id, qty')
    .eq('projection_id', projection.id)

  const styleIds = (lines ?? []).map((l) => l.style_id)
  const { data: styles } = await supabase
    .from('styles')
    .select('id, code, name')
    .in('id', styleIds.length ? styleIds : ['00000000-0000-0000-0000-000000000000'])
  const styleLabel = new Map((styles ?? []).map((s) => [s.id, `${s.code} · ${s.name}`]))

  // Ending stock per style: styles -> colorways -> skus -> stock_balances (sum balance).
  const { data: colorways } = await supabase
    .from('colorways')
    .select('id, style_id')
    .in('style_id', styleIds.length ? styleIds : ['00000000-0000-0000-0000-000000000000'])
  const styleOfColorway = new Map((colorways ?? []).map((c) => [c.id, c.style_id]))
  const cwIds = (colorways ?? []).map((c) => c.id)

  const { data: skus } = await supabase
    .from('skus')
    .select('id, colorway_id')
    .in('colorway_id', cwIds.length ? cwIds : ['00000000-0000-0000-0000-000000000000'])
  const styleOfSku = new Map((skus ?? []).map((s) => [s.id, styleOfColorway.get(s.colorway_id)]))
  const skuIds = (skus ?? []).map((s) => s.id)

  const { data: balances } = await supabase
    .from('stock_balances')
    .select('sku_id, balance')
    .in('sku_id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])

  const endingStockByStyle = new Map<string, number>()
  for (const b of balances ?? []) {
    if (!b.sku_id) continue
    const styleId = styleOfSku.get(b.sku_id)
    if (!styleId) continue
    endingStockByStyle.set(styleId, (endingStockByStyle.get(styleId) ?? 0) + Number(b.balance ?? 0))
  }

  const rows = (lines ?? []).map((l) => ({
    style_id: l.style_id,
    label: styleLabel.get(l.style_id) ?? l.style_id,
    target_sales: Number(l.qty),
    ending_stock: endingStockByStyle.get(l.style_id) ?? 0,
  }))

  return (
    <div>
      <Link href={`/projections/${projection.id}`} className="vb-back">← Proyeksi</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Buat PCB</h1>
        <div className="vb-sub">dari proyeksi {projection.period}</div>
      </div>
      <PcbForm projectionId={projection.id} quarter={projection.period} rows={rows} />
    </div>
  )
}
