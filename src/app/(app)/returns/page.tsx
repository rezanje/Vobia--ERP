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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Returns</h1>
        <Link href="/returns/new" className="vb-btn" style={{ textDecoration: 'none' }}>New return</Link>
      </div>
      {!returns?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No returns yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Order</th>
                <th style={{ padding: 12 }}>Date</th><th style={{ padding: 12 }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/returns/${r.id}`} style={{ color: 'var(--vb-accent)' }}>{r.code}</Link></td>
                  <td style={{ padding: 12 }}>{orderCode.get(r.order_id) ?? '—'}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{r.return_date}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
