import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Production</h1>
        <Link href="/production/new" className="vb-btn" style={{ textDecoration: 'none' }}>New order</Link>
      </div>
      {!orders?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No production orders yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Style</th>
                <th style={{ padding: 12 }}>Vendor</th><th style={{ padding: 12 }}>Stage</th><th style={{ padding: 12 }}>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/production/${o.id}`} style={{ color: 'var(--vb-accent)' }}>{o.code}</Link></td>
                  <td style={{ padding: 12 }}>{styleCode.get(o.style_id) ?? '—'}</td>
                  <td style={{ padding: 12 }}>{vendorName.get(o.vendor_id) ?? '—'}</td>
                  <td style={{ padding: 12 }}><span className="vb-chip on">{o.stage}</span></td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{o.deadline ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
