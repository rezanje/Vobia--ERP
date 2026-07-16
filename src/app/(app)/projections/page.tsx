import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AlignmentForm from './AlignmentForm'

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  locked: { label: 'Terkunci', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function ProjectionsPage() {
  const supabase = await createClient()
  const { data: projections } = await supabase
    .from('projections')
    .select('id, period, status, created_at')
    .order('created_at', { ascending: false })
  const { data: projLines } = await supabase.from('projection_lines').select('projection_id, qty')
  const { data: forecasts } = await supabase.from('forecasts').select('id, kind, period')
  const { data: forecastLines } = await supabase.from('forecast_lines').select('forecast_id, style_id, qty')
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')
  const { data: rawNewProducts } = await supabase
    .from('new_products')
    .select('id, name, style_id, agreed_qty')
    .eq('mkt_status', 'tervalidasi')
    .not('agreed_qty', 'is', null)
    .not('style_id', 'is', null)

  const totalByProjection = new Map<string, number>()
  for (const l of projLines ?? []) {
    totalByProjection.set(l.projection_id, (totalByProjection.get(l.projection_id) ?? 0) + Number(l.qty))
  }

  const forecastMeta = new Map((forecasts ?? []).map((f) => [f.id, { kind: f.kind, period: f.period }]))
  const periodMap = new Map<string, { salesByStyle: Record<string, number>; opsByStyle: Record<string, number> }>()
  for (const f of forecasts ?? []) {
    if (!periodMap.has(f.period)) periodMap.set(f.period, { salesByStyle: {}, opsByStyle: {} })
  }
  for (const l of forecastLines ?? []) {
    const f = forecastMeta.get(l.forecast_id)
    if (!f) continue
    const bucket = periodMap.get(f.period)
    if (!bucket) continue
    const target = f.kind === 'ops' ? bucket.opsByStyle : bucket.salesByStyle
    target[l.style_id] = (target[l.style_id] ?? 0) + Number(l.qty)
  }
  const periods = [...periodMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, ...v }))

  const newProducts = (rawNewProducts ?? []).map((n) => ({
    id: n.id, name: n.name, style_id: n.style_id as string, agreed_qty: n.agreed_qty as number,
  }))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Proyeksi</h1>
        <div className="vb-sub">{projections?.length ?? 0} proyeksi</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 110px 110px' }}>
            <div>Periode</div><div>Status</div><div>Total Qty</div>
          </div>
          {!projections?.length ? (
            <div className="vb-empty">Belum ada proyeksi.</div>
          ) : projections.map((p) => {
            const meta = STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <Link key={p.id} href={`/projections/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1fr 110px 110px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.period}</div>
                <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                <div style={{ fontSize: 12.5 }}>{totalByProjection.get(p.id) ?? 0}</div>
              </Link>
            )
          })}
        </div>
        <AlignmentForm periods={periods} styles={styles ?? []} newProducts={newProducts} />
      </div>
    </div>
  )
}
