import { createClient } from '@/lib/supabase/server'
import ChannelForm from './ChannelForm'

export default async function ChannelsPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name, active').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Channel</h1>
        <div className="vb-sub">{channels?.length ?? 0} channel penjualan</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12, alignItems: 'start', maxWidth: 900 }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 100px' }}>
            <div>Nama</div><div>Status</div>
          </div>
          {!channels?.length ? (
            <div className="vb-empty">Belum ada channel.</div>
          ) : channels.map((c) => (
            <div key={c.id} className="vb-row" style={{ gridTemplateColumns: '1fr 100px' }}>
              <div style={{ fontWeight: 500 }}>{c.name}</div>
              <div>
                <span className="vb-badge" style={c.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {c.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <ChannelForm />
      </div>
    </div>
  )
}
