import { createClient } from '@/lib/supabase/server'
import VendorForm from './VendorForm'

export default async function VendorsPage() {
  const supabase = await createClient()
  const { data: vendors } = await supabase.from('vendors').select('id, name, contact, active').order('name')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Vendors</h1>
      <VendorForm />
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Name</th><th style={{ padding: 12 }}>Contact</th><th style={{ padding: 12 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {!vendors?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>No vendors yet.</td></tr>
            ) : vendors.map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{v.name}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{v.contact ?? '—'}</td>
                <td style={{ padding: 12 }}>{v.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
