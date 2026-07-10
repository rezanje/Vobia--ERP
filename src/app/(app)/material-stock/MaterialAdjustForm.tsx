'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordMaterialAdjustment } from '@/lib/materials/stock'

type MatOption = { id: string; code: string; name: string }
type LocOption = { id: string; name: string }

export default function MaterialAdjustForm({ materials, locations }: { materials: MatOption[]; locations: LocOption[] }) {
  const router = useRouter()
  const [matId, setMatId] = useState('')
  const [locId, setLocId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = Number(qty)
    if (!matId) { setError('Pilih bahan'); return }
    if (!Number.isFinite(n) || n === 0) { setError('Qty harus angka bukan nol'); return }
    if (!reason.trim()) { setError('Alasan wajib diisi'); return }
    setSaving(true)
    const res = await recordMaterialAdjustment({ material_id: matId, qty: n, reason: reason.trim(), location_id: locId || undefined })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); setReason(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Penyesuaian Stok Bahan</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px 1.3fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="vb-label">Bahan</label>
          <select className="vb-input" value={matId} onChange={(e) => setMatId(e.target.value)}>
            <option value="">Pilih bahan…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Lokasi</label>
          <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
            <option value="">Default</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty (±)</label>
          <input className="vb-input" placeholder="-5" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Alasan</label>
          <input className="vb-input" placeholder="Opname bahan" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ height: 37 }}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
