import { createClient } from '@/lib/supabase/server'
import ChannelForm from './ChannelForm'

export default async function ChannelsPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name, active').order('name')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Channels</h1>
      <ChannelForm />
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Name</th><th style={{ padding: 12 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {!channels?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={2}>No channels yet.</td></tr>
            ) : channels.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{c.name}</td>
                <td style={{ padding: 12 }}>{c.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
