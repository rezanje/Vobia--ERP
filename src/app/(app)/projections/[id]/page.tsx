import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LockButton from './LockButton'

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  locked: { label: 'Terkunci', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function ProjectionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: projection } = await supabase.from('projections').select('*').eq('id', id).single()
  if (!projection) notFound()

  const { data: lines } = await supabase
    .from('projection_lines')
    .select('id, style_id, qty, kind, new_product_id')
    .eq('projection_id', id)

  const styleIds = (lines ?? []).map((l) => l.style_id)
  const { data: styles } = await supabase
    .from('styles')
    .select('id, code, name')
    .in('id', styleIds.length ? styleIds : ['00000000-0000-0000-0000-000000000000'])
  const styleName = new Map((styles ?? []).map((s) => [s.id, `${s.code} · ${s.name}`]))

  const npIds = (lines ?? []).map((l) => l.new_product_id).filter((x): x is string => !!x)
  const { data: newProducts } = await supabase
    .from('new_products')
    .select('id, name')
    .in('id', npIds.length ? npIds : ['00000000-0000-0000-0000-000000000000'])
  const npName = new Map((newProducts ?? []).map((n) => [n.id, n.name]))

  const meta = STATUS_META[projection.status] ?? { label: projection.status, c: 'var(--vb-muted)', bg: 'transparent' }
  const total = (lines ?? []).reduce((s, l) => s + Number(l.qty), 0)

  return (
    <div>
      <Link href="/projections" className="vb-back">← Proyeksi</Link>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 className="vb-h1">
            {projection.period}
            <span className="vb-badge" style={{ background: meta.bg, color: meta.c, marginLeft: 8 }}>{meta.label}</span>
          </h1>
          <div className="vb-sub">{lines?.length ?? 0} baris · total qty {total}</div>
        </div>
        {projection.status === 'draft' ? (
          <LockButton id={projection.id} />
        ) : (
          <Link href={`/pcb/new?projection=${projection.id}`} className="vb-btn">Buat PCB dari proyeksi ini →</Link>
        )}
      </div>
      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 100px 200px' }}>
          <div>Style</div><div>Qty</div><div>Jenis</div>
        </div>
        {!lines?.length ? (
          <div className="vb-empty">Belum ada baris.</div>
        ) : lines.map((l) => (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 100px 200px' }}>
            <div style={{ fontSize: 12.5 }}>{styleName.get(l.style_id) ?? l.style_id}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.qty}</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>
              {l.kind === 'seasonal_new' ? `Seasonal Baru${l.new_product_id ? ` · ${npName.get(l.new_product_id) ?? ''}` : ''}` : 'Regular'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
