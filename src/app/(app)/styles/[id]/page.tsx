import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SkuToggle from './SkuToggle'
import BomSection from './BomSection'

export default async function StyleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: style } = await supabase.from('styles').select('*').eq('id', id).single()
  if (!style) notFound()

  const { data: colorways } = await supabase
    .from('colorways').select('id, color_name, color_code').eq('style_id', id)
  const cwIds = (colorways ?? []).map((c) => c.id)
  const { data: skus } = await supabase
    .from('skus').select('id, colorway_id, size, sku_code, active').in('colorway_id', cwIds.length ? cwIds : ['00000000-0000-0000-0000-000000000000'])

  const { data: bomRows } = await supabase.from('bom_lines').select('id, material_id, qty_per_unit').eq('style_id', id)
  const { data: allMaterials } = await supabase.from('materials').select('id, code, name').eq('active', true).order('code')

  return (
    <div>
      <Link href="/styles" className="vb-back">← Styles</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">{style.name}</h1>
        <div className="vb-sub">{style.code}{style.collection ? ` · ${style.collection}` : ''}</div>
      </div>

      <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 820 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.5fr 1.2fr 70px 130px' }}>
          <div>Kode SKU</div><div>Colorway</div><div>Size</div><div>Status</div>
        </div>
        {(skus ?? []).map((k) => {
          const cw = colorways?.find((c) => c.id === k.colorway_id)
          return (
            <div key={k.id} className="vb-row" style={{ gridTemplateColumns: '1.5fr 1.2fr 70px 130px' }}>
              <div className="vb-mono" style={{ fontWeight: 500 }}>{k.sku_code}</div>
              <div className="vb-text2">{cw?.color_name ?? '—'}</div>
              <div className="vb-mono">{k.size}</div>
              <SkuToggle id={k.id} active={k.active} />
            </div>
          )
        })}
      </div>

      <BomSection
        styleId={id}
        materials={allMaterials ?? []}
        rows={(bomRows ?? []).map((r) => ({ id: r.id, material_id: r.material_id, qty_per_unit: Number(r.qty_per_unit) }))}
      />
    </div>
  )
}
