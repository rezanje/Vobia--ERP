'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createOrder, type OrderLineInput } from '@/lib/orders/actions'
import { rp } from '@/lib/ui'

type Opt = { id: string; name?: string; sku_code?: string }

export default function OrderForm({ channels, skus }: { channels: Opt[]; skus: Opt[] }) {
  const router = useRouter()
  const [channelId, setChannelId] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [customer, setCustomer] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string; price: string }[]>([{ sku_id: '', qty: '', price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const total = useMemo(() => lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0) * (Number(l.price) || 0), 0), [lines])

  async function onSave() {
    setError(null)
    if (!channelId) { setError('Pilih channel'); return }
    const parsed: OrderLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Tiap line butuh qty positif'); return }
      parsed.push({ sku_id: l.sku_id, qty: q, unit_price: Number(l.price) || 0 })
    }
    if (!parsed.length) { setError('Tambahkan minimal satu line'); return }
    setSaving(true)
    const res = await createOrder({ channel_id: channelId, order_date: orderDate, customer, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="vb-danger">{error}</div>}
      <div className="vb-card" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="vb-label">Channel</label>
            <select className="vb-input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">Pilih channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="vb-label">Tanggal</label>
            <input className="vb-input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="vb-label">Customer</label>
            <input className="vb-input" placeholder="Nama customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          <div>
            <label className="vb-label">Catatan</label>
            <input className="vb-input" placeholder="Opsional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="vb-card" style={{ padding: 18 }}>
        <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Line Order</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.7fr 80px 140px 120px 34px', gap: 8, alignItems: 'center' }}>
              <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
                <option value="">Pilih SKU…</option>
                {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
              </select>
              <input className="vb-input" placeholder="Qty" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
              <input className="vb-input" placeholder="Harga" value={l.price} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
              <div className="vb-mono vb-text2" style={{ textAlign: 'right', fontSize: 12.5 }}>{rp((parseInt(l.qty, 10) || 0) * (Number(l.price) || 0))}</div>
              <button className="vb-btn-x" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button className="vb-btn-line" style={{ marginTop: 10 }} type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '', price: '' }])}>+ Tambah line</button>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 12, marginTop: 14, borderTop: '1px solid rgba(255,255,255,.045)', paddingTop: 12 }}>
          <div className="vb-muted" style={{ fontSize: 12.5 }}>Total</div>
          <div className="vb-mono vb-accent" style={{ fontSize: 18, fontWeight: 600 }}>{rp(total)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="vb-btn-ghost" type="button" onClick={() => router.push('/orders')}>Batal</button>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Menyimpan…' : 'Simpan Order'}</button>
      </div>
    </div>
  )
}
