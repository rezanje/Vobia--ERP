import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function StylesPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase
    .from('style_summary')
    .select('id, code, name, collection, colorway_count, sku_count')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Styles</h1>
        <Link href="/styles/new" className="vb-btn" style={{ textDecoration: 'none' }}>New style</Link>
      </div>

      {!styles?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No styles yet. Create your first style.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Name</th>
                <th style={{ padding: 12 }}>Collection</th><th style={{ padding: 12 }}>Colorways</th>
                <th style={{ padding: 12 }}>SKUs</th>
              </tr>
            </thead>
            <tbody>
              {styles.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}>
                    <Link href={`/styles/${s.id}`} style={{ color: 'var(--vb-accent)' }}>{s.code}</Link>
                  </td>
                  <td style={{ padding: 12 }}>{s.name}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{s.collection ?? '—'}</td>
                  <td style={{ padding: 12 }}>{s.colorway_count}</td>
                  <td style={{ padding: 12 }}>{s.sku_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
