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
    if (!skuId) { setError('Pick a SKU'); return }
    if (!Number.isInteger(n) || n === 0) { setError('Qty must be a non-zero integer'); return }
    if (!reason.trim()) { setError('Reason is required'); return }
    setSaving(true)
    const res = await recordAdjustment({ sku_id: skuId, qty: n, reason: reason.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); setReason('')
    router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 520, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>Adjustment</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select className="vb-input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
          <option value="">Select SKU…</option>
          {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
        </select>
        <input className="vb-input" placeholder="Qty (e.g. 15 or -5)" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input className="vb-input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Record adjustment'}
        </button>
      </div>
    </div>
  )
}
