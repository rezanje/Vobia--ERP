'use client'
import { useState } from 'react'
import { createReturn, type ReturnLineInput } from '@/lib/returns/actions'

type Opt = { id: string; code?: string; sku_code?: string }

export default function ReturnForm({ orders, skus }: { orders: Opt[]; skus: Opt[] }) {
  const [orderId, setOrderId] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!orderId) { setError('Pick an order'); return }
    const parsed: ReturnLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty: q })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createReturn({ order_id: orderId, return_date: returnDate, reason, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Select order…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
        </select>
        <input className="vb-input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        <input className="vb-input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="vb-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
              <option value="">Select SKU…</option>
              {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
            </select>
            <input className="vb-input" placeholder="Qty" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create return (posts return_in)'}</button></div>
    </div>
  )
}
