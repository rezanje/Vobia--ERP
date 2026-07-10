'use client'
import { useState } from 'react'
import { createPurchaseOrder, type PurchaseLineInput } from '@/lib/purchasing/actions'

type VendorOption = { id: string; name: string }
type MatOption = { id: string; code: string; name: string }
type LocOption = { id: string; name: string }
type Row = { material_id: string; qty_ordered: string; unit_price: string }

export default function PurchaseForm({ vendors, materials, locations }: { vendors: VendorOption[]; materials: MatOption[]; locations: LocOption[] }) {
  const [vendorId, setVendorId] = useState('')
  const [locId, setLocId] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([{ material_id: '', qty_ordered: '', unit_price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function onSave() {
    setError(null)
    if (!vendorId) { setError('Pilih vendor'); return }
    const lines: PurchaseLineInput[] = []
    for (const r of rows) {
      if (!r.material_id) continue
      const q = Number(r.qty_ordered), p = Number(r.unit_price || '0')
      if (!Number.isFinite(q) || q <= 0) { setError('Qty tiap baris harus > 0'); return }
      lines.push({ material_id: r.material_id, qty_ordered: q, unit_price: Number.isFinite(p) ? p : 0 })
    }
    if (!lines.length) { setError('Minimal satu baris bahan'); return }
    setSaving(true)
    const res = await createPurchaseOrder({ vendor_id: vendorId, location_id: locId || undefined, notes: notes.trim(), lines })
    setSaving(false)
    if (res?.error) { setError(res.error); setSaving(false) }
    // success → server action redirects
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>PO Bahan Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="vb-label">Vendor</label>
          <select className="vb-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Pilih vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Terima di lokasi</label>
          <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
            <option value="">Default</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <label className="vb-label">Baris bahan</label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 120px 30px', gap: 8, marginBottom: 6 }}>
          <select className="vb-input" value={r.material_id} onChange={(e) => setRow(i, { material_id: e.target.value })}>
            <option value="">Pilih bahan…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
          <input className="vb-input" placeholder="Qty" value={r.qty_ordered} onChange={(e) => setRow(i, { qty_ordered: e.target.value })} />
          <input className="vb-input" placeholder="Harga/unit" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} />
          <button type="button" className="vb-btn" style={{ padding: 0 }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>×</button>
        </div>
      ))}
      <button type="button" className="vb-btn" style={{ marginTop: 4, marginBottom: 12 }}
        onClick={() => setRows((rs) => [...rs, { material_id: '', qty_ordered: '', unit_price: '' }])}>+ Baris</button>

      <div>
        <label className="vb-label">Catatan</label>
        <input className="vb-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12, alignSelf: 'flex-end' }}>
        {saving ? 'Menyimpan…' : 'Buat PO'}
      </button>
    </div>
  )
}
