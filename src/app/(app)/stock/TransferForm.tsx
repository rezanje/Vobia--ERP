'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordTransfer } from '@/lib/stock/actions'

type SkuOption = { id: string; sku_code: string }
type LocOption = { id: string; name: string }

export default function TransferForm({ skus, locations }: { skus: SkuOption[]; locations: LocOption[] }) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = parseInt(qty, 10)
    if (!skuId) { setError('Pilih SKU'); return }
    if (!from || !to) { setError('Pilih lokasi asal & tujuan'); return }
    if (from === to) { setError('Lokasi asal & tujuan harus beda'); return }
    if (!Number.isInteger(n) || n <= 0) { setError('Qty harus angka positif'); return }
    setSaving(true)
    const res = await recordTransfer({ sku_id: skuId, qty: n, from_location: from, to_location: to })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Transfer Antar Lokasi</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 80px auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="vb-label">SKU</label>
          <select className="vb-input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Pilih SKU…</option>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Dari</label>
          <select className="vb-input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Asal…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Ke</label>
          <select className="vb-input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Tujuan…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty</label>
          <input className="vb-input" placeholder="6" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ height: 37 }}>
          {saving ? 'Memindah…' : 'Transfer'}
        </button>
      </div>
    </div>
  )
}
