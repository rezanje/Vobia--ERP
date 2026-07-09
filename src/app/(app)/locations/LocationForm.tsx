'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLocation } from '@/lib/locations/actions'

export default function LocationForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    setSaving(true)
    const res = await createLocation({ name: name.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Lokasi Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="Toko Bandung" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Lokasi'}</button>
      </div>
    </div>
  )
}
