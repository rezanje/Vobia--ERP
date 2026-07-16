'use client'
import { useState } from 'react'
import { createNewProduct } from '@/lib/planning/actions'

type StyleOption = { id: string; code: string; name: string }

export default function NewProductForm({ styles }: { styles: StyleOption[] }) {
  const [name, setName] = useState('')
  const [styleId, setStyleId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama produk wajib diisi'); return }
    setSaving(true)
    const res = await createNewProduct({ name: name.trim(), style_id: styleId || undefined, notes: notes.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setStyleId(''); setNotes('')
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Produk Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ marginBottom: 10 }}>
        <label className="vb-label">Nama</label>
        <input className="vb-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label className="vb-label">Style</label>
        <select className="vb-input" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          <option value="">Belum ada style</option>
          {styles.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="vb-label">Catatan</label>
        <input className="vb-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12 }}>
        {saving ? 'Menyimpan…' : 'Tambah Produk'}
      </button>
    </div>
  )
}
