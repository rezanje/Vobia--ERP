import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SkuToggle from './SkuToggle'

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

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{style.name}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{style.code}{style.collection ? ` · ${style.collection}` : ''}</p>

      <div className="vb-card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Colorway</th><th style={{ padding: 12 }}>Size</th>
              <th style={{ padding: 12 }}>SKU code</th><th style={{ padding: 12 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(skus ?? []).map((k) => {
              const cw = colorways?.find((c) => c.id === k.colorway_id)
              return (
                <tr key={k.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}>{cw?.color_name ?? '—'}</td>
                  <td style={{ padding: 12 }}>{k.size}</td>
                  <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{k.sku_code}</td>
                  <td style={{ padding: 12 }}><SkuToggle id={k.id} active={k.active} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
