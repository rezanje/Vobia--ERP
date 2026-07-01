'use client'
import { useState } from 'react'
import { createProductionOrder, type LineInput } from '@/lib/production/actions'

type Opt = { id: string; code?: string; name?: string; sku_code?: string }

export default function OrderForm({ styles, vendors, skus }: { styles: Opt[]; vendors: Opt[]; skus: Opt[] }) {
  const [styleId, setStyleId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!styleId) { setError('Pick a style'); return }
    if (!vendorId) { setError('Pick a vendor'); return }
    const parsed: LineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty_ordered: q })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createProductionOrder({ style_id: styleId, vendor_id: vendorId, deadline, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          <option value="">Select style…</option>
          {styles.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
        <select className="vb-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input className="vb-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <input className="vb-input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
              <option value="">Select SKU…</option>
              {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
            </select>
            <input className="vb-input" placeholder="Qty ordered" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create order'}</button></div>
    </div>
  )
}
