'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordAdjustment } from '@/lib/stock/actions'

type SkuOption = { id: string; sku_code: string }

export default function AdjustForm({ skus }: { skus: SkuOption[] }) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = parseInt(qty, 10)
    if (!skuId) { setError('Pilih SKU'); return }
    if (!Number.isInteger(n) || n === 0) { setError('Qty harus angka bukan nol'); return }
    if (!reason.trim()) { setError('Alasan wajib diisi'); return }
    setSaving(true)
    const res = await recordAdjustment({ sku_id: skuId, qty: n, reason: reason.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); setReason('')
    router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Penyesuaian Stok</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 100px 1.4fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="vb-label">SKU</label>
          <select className="vb-input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Pilih SKU…</option>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty (±)</label>
          <input className="vb-input" placeholder="-2" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Alasan</label>
          <input className="vb-input" placeholder="Stock opname" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ height: 37 }}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
