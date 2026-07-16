'use client'
import { useState } from 'react'
import { updateNewProduct } from '@/lib/planning/actions'

type NP = {
  id: string
  name: string
  style_id: string | null
  rnd_status: string
  mkt_status: string
  agreed_qty: number | null
  notes: string | null
}

export default function NewProductRow({ p, canWrite }: { p: NP; canWrite: boolean }) {
  const [rnd, setRnd] = useState(p.rnd_status)
  const [mkt, setMkt] = useState(p.mkt_status)
  const [qty, setQty] = useState(p.agreed_qty != null ? String(p.agreed_qty) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ready = p.mkt_status === 'tervalidasi' && p.agreed_qty != null && !!p.style_id

  async function onSave() {
    setError(null)
    setSaving(true)
    const q = qty.trim() ? Number(qty) : null
    const res = await updateNewProduct({ id: p.id, rnd_status: rnd, mkt_status: mkt, agreed_qty: q })
    setSaving(false)
    if (res?.error) setError(res.error)
  }

  return (
    <div className="vb-row" style={{ gridTemplateColumns: '1.4fr 120px 120px 90px 70px', gap: 8 }}>
      <div style={{ fontSize: 12.5 }}>
        {p.name}
        {ready && <span className="vb-badge" style={{ background: 'rgba(147,214,161,.13)', color: '#93d6a1', marginLeft: 8 }}>Siap masuk proyeksi</span>}
      </div>
      <select className="vb-input" value={rnd} onChange={(e) => setRnd(e.target.value)} disabled={!canWrite}>
        <option value="design">Desain</option>
        <option value="prototype">Prototipe</option>
        <option value="done">Selesai</option>
      </select>
      <select className="vb-input" value={mkt} onChange={(e) => setMkt(e.target.value)} disabled={!canWrite}>
        <option value="belum">Belum</option>
        <option value="cek_ombak">Cek Ombak</option>
        <option value="tervalidasi">Tervalidasi</option>
      </select>
      <input className="vb-input" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!canWrite} />
      {canWrite && <button type="button" className="vb-btn-mini" disabled={saving} onClick={onSave}>{saving ? '…' : 'Simpan'}</button>}
      {error && <div className="vb-danger" style={{ gridColumn: '1 / -1', fontSize: 11.5 }}>{error}</div>}
    </div>
  )
}
