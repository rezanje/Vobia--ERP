'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createVendor } from '@/lib/production/actions'

export default function VendorForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const res = await createVendor({ name: name.trim(), contact: contact.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setContact(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 520, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>New vendor</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="vb-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="vb-input" placeholder="Contact (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add vendor'}</button>
      </div>
    </div>
  )
}
