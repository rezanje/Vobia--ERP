'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createMaterial } from '@/lib/materials/actions'

const CATEGORIES = [
  { v: 'fabric', l: 'Kain' },
  { v: 'trim', l: 'Trim' },
  { v: 'accessory', l: 'Aksesoris' },
  { v: 'other', l: 'Lainnya' },
]

export default function MaterialForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('fabric')
  const [uom, setUom] = useState('m')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!code.trim()) { setError('Kode wajib diisi'); return }
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    if (!uom.trim()) { setError('Satuan wajib diisi'); return }
    setSaving(true)
    const res = await createMaterial({ code: code.trim(), name: name.trim(), category, uom: uom.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setCode(''); setName(''); setUom('m'); setCategory('fabric'); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Bahan Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Kode</label>
          <input className="vb-input" placeholder="FAB-001" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="Katun Combed 30s" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Kategori</label>
          <select className="vb-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Satuan</label>
          <input className="vb-input" placeholder="m / pcs / roll / kg" value={uom} onChange={(e) => setUom(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Bahan'}</button>
      </div>
    </div>
  )
}
