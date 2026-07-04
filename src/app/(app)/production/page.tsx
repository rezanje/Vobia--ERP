import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { STAGE_META } from '@/lib/ui'

export default async function ProductionPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase
    .from('production_orders').select('id, code, stage, deadline, style_id, vendor_id')
    .order('created_at', { ascending: false })
  const { data: styles } = await supabase.from('styles').select('id, code')
  const { data: vendors } = await supabase.from('vendors').select('id, name')
  const styleCode = new Map((styles ?? []).map((s) => [s.id, s.code]))
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]))

  return (
    <div>
      <div className="vb-pagehead">
        <div>
          <h1 className="vb-h1">Produksi</h1>
          <div className="vb-sub">{orders?.length ?? 0} order produksi</div>
        </div>
        <Link href="/production/new" className="vb-btn">+ Order Produksi</Link>
      </div>
      {!orders?.length ? (
        <div className="vb-empty">Belum ada order produksi.</div>
      ) : (
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '130px 110px 1.5fr 140px 110px' }}>
            <div>Kode</div><div>Style</div><div>Vendor</div><div>Stage</div><div>Deadline</div>
          </div>
          {orders.map((o) => {
            const meta = STAGE_META[o.stage] ?? { label: o.stage, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <Link key={o.id} href={`/production/${o.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '130px 110px 1.5fr 140px 110px', textDecoration: 'none', color: 'inherit' }}>
                <div className="vb-mono vb-accent" style={{ fontWeight: 500 }}>{o.code}</div>
                <div className="vb-mono" style={{ fontSize: 12.5 }}>{styleCode.get(o.style_id) ?? '—'}</div>
                <div>{vendorName.get(o.vendor_id) ?? '—'}</div>
                <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{o.deadline ?? '—'}</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
