'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProductionOrder, type LineInput } from '@/lib/production/actions'

type Opt = { id: string; code?: string; name?: string; sku_code?: string }

export default function OrderForm({ styles, vendors, skus }: { styles: Opt[]; vendors: Opt[]; skus: Opt[] }) {
  const router = useRouter()
  const [styleId, setStyleId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!styleId) { setError('Pilih style'); return }
    if (!vendorId) { setError('Pilih vendor'); return }
    const parsed: LineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Tiap line butuh qty positif'); return }
      parsed.push({ sku_id: l.sku_id, qty_ordered: q })
    }
    if (!parsed.length) { setError('Tambahkan minimal satu line'); return }
    setSaving(true)
    const res = await createProductionOrder({ style_id: styleId, vendor_id: vendorId, deadline, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="vb-danger">{error}</div>}
      <div className="vb-card" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="vb-label">Style</label>
            <select className="vb-input" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              <option value="">Pilih style…</option>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="vb-label">Vendor</label>
            <select className="vb-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Pilih vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="vb-label">Deadline</label>
            <input className="vb-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div>
            <label className="vb-label">Catatan</label>
            <input className="vb-input" placeholder="Catatan produksi" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="vb-card" style={{ padding: 18 }}>
        <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Line Produksi</div>
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
        <button className="vb-btn-ghost" type="button" onClick={() => router.push('/production')}>Batal</button>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Menyimpan…' : 'Buat Order Produksi'}</button>
      </div>
    </div>
  )
}
