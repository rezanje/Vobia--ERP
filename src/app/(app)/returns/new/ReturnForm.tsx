'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createReturn, type ReturnLineInput } from '@/lib/returns/actions'

type Opt = { id: string; code?: string; sku_code?: string }

export default function ReturnForm({ orders, skus }: { orders: Opt[]; skus: Opt[] }) {
  const router = useRouter()
  const [orderId, setOrderId] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!orderId) { setError('Pilih order'); return }
    const parsed: ReturnLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Tiap line butuh qty positif'); return }
      parsed.push({ sku_id: l.sku_id, qty: q })
    }
    if (!parsed.length) { setError('Tambahkan minimal satu line'); return }
    setSaving(true)
    const res = await createReturn({ order_id: orderId, return_date: returnDate, reason, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="vb-danger">{error}</div>}
      <div className="vb-card" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="vb-label">Order</label>
            <select className="vb-input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Pilih order…</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
            </select>
          </div>
          <div>
            <label className="vb-label">Tanggal</label>
            <input className="vb-input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="vb-label">Alasan</label>
            <input className="vb-input" placeholder="Ukuran tidak sesuai" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <label className="vb-label">Catatan</label>
            <input className="vb-input" placeholder="Opsional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="vb-card" style={{ padding: 18 }}>
        <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Line Retur</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.7fr 110px 34px', gap: 8, alignItems: 'center' }}>
              <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
                <option value="">Pilih SKU…</option>
                {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
              </select>
              <input className="vb-input" placeholder="Qty" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
              <button className="vb-btn-x" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button className="vb-btn-line" style={{ marginTop: 10 }} type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '' }])}>+ Tambah line</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="vb-btn-ghost" type="button" onClick={() => router.push('/returns')}>Batal</button>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Menyimpan…' : 'Simpan Retur'}</button>
      </div>
    </div>
  )
}
