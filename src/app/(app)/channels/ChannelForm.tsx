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
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const res = await createChannel({ name: name.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 420, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>New channel</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="vb-input" placeholder="Name (Shopee, Offline…)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add'}</button>
      </div>
    </div>
  )
}
