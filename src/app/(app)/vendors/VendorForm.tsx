'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createVendor } from '@/lib/production/actions'

export default function VendorForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [moq, setMoq] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    setSaving(true)
    const moqN = moq.trim() === '' ? null : Number(moq)
    if (moqN !== null && (!Number.isInteger(moqN) || moqN <= 0)) { setError('MOQ harus bilangan bulat > 0'); return }
    const res = await createVendor({ name: name.trim(), contact: contact.trim(), moq: moqN })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setContact(''); setMoq(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Vendor Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="CV Maju Garmen" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Kontak</label>
          <input className="vb-input" placeholder="Pak Budi · 0812-xxxx-xxxx" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">MOQ (unit per order, kosongkan jika tidak ada)</label>
          <input className="vb-input" type="number" min={1} placeholder="500" value={moq} onChange={(e) => setMoq(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Vendor'}</button>
      </div>
    </div>
  )
}
