import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ReturnsPage() {
  const supabase = await createClient()
  const { data: returns } = await supabase
    .from('returns').select('id, code, return_date, order_id, reason')
    .order('return_date', { ascending: false })
  const { data: orders } = await supabase.from('orders').select('id, code')
  const orderCode = new Map((orders ?? []).map((o) => [o.id, o.code]))

  return (
    <div>
      <div className="vb-pagehead">
        <div>
          <h1 className="vb-h1">Retur</h1>
          <div className="vb-sub">{returns?.length ?? 0} retur tercatat</div>
        </div>
        <Link href="/returns/new" className="vb-btn">+ Retur Baru</Link>
      </div>
      {!returns?.length ? (
        <div className="vb-empty">Belum ada retur.</div>
      ) : (
        <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 900 }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '130px 140px 120px 1.5fr' }}>
            <div>Kode</div><div>Order</div><div>Tanggal</div><div>Alasan</div>
          </div>
          {returns.map((r) => (
            <Link key={r.id} href={`/returns/${r.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '130px 140px 120px 1.5fr', textDecoration: 'none', color: 'inherit' }}>
              <div className="vb-mono vb-accent" style={{ fontWeight: 500 }}>{r.code}</div>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{orderCode.get(r.order_id) ?? '—'}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{r.return_date}</div>
              <div className="vb-text2">{r.reason ?? '—'}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
