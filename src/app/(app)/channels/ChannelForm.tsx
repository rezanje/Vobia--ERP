'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChannel } from '@/lib/orders/actions'

export default function ChannelForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    setSaving(true)
    const res = await createChannel({ name: name.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Channel Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="Zalora" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Channel'}</button>
      </div>
    </div>
  )
}
