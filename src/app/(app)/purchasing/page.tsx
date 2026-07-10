import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PurchaseForm from './PurchaseForm'

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  open: { label: 'Terbuka', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  received: { label: 'Diterima', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  canceled: { label: 'Batal', c: '#ff9b9b', bg: 'rgba(255,155,155,.13)' },
}

export default async function PurchasingPage() {
  const supabase = await createClient()
  const { data: pos } = await supabase.from('purchase_orders').select('id, code, vendor_id, status, order_date').order('created_at', { ascending: false })
  const { data: vendors } = await supabase.from('vendors').select('id, name').eq('active', true).order('name')
  const { data: materials } = await supabase.from('materials').select('id, code, name').eq('active', true).order('code')
  const { data: locations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Pembelian</h1>
        <div className="vb-sub">{pos?.length ?? 0} PO bahan</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.1fr 1.4fr 110px 110px' }}>
            <div>Kode</div><div>Vendor</div><div>Tanggal</div><div>Status</div>
          </div>
          {!pos?.length ? (
            <div className="vb-empty">Belum ada PO.</div>
          ) : pos.map((p) => {
            const meta = STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <Link key={p.id} href={`/purchasing/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1.1fr 1.4fr 110px 110px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.code}</div>
                <div style={{ fontSize: 12.5 }}>{vendorName.get(p.vendor_id) ?? '—'}</div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{p.order_date}</div>
                <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
              </Link>
            )
          })}
        </div>
        <PurchaseForm vendors={vendors ?? []} materials={materials ?? []} locations={locations ?? []} />
      </div>
    </div>
  )
}
