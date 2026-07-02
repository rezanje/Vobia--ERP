'use client'
import { useState } from 'react'
import { createOrder, type OrderLineInput } from '@/lib/orders/actions'

type Opt = { id: string; name?: string; sku_code?: string }

export default function OrderForm({ channels, skus }: { channels: Opt[]; skus: Opt[] }) {
  const [channelId, setChannelId] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [customer, setCustomer] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string; price: string }[]>([{ sku_id: '', qty: '', price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!channelId) { setError('Pick a channel'); return }
    const parsed: OrderLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty: q, unit_price: Number(l.price) || 0 })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createOrder({ channel_id: channelId, order_date: orderDate, customer, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">Select channel…</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="vb-input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        <input className="vb-input" placeholder="Customer (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
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
            <input className="vb-input" placeholder="Unit price" value={l.price} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '', price: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create order (posts sale_out)'}</button></div>
    </div>
  )
}
