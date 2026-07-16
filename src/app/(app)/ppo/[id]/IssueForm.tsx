'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { issuePpoPos, type PpoChildInput } from '@/lib/ppic/actions'
import { PO_TYPE_LABEL } from '@/lib/ui'

type VendorOption = { id: string; name: string }
type MatOption = { id: string; code: string; name: string }
type PoType = PpoChildInput['po_type']

type Row = {
  po_type: PoType
  vendor_id: string
  amount: string
  notes: string
  material_id: string
  qty: string
  unit_price: string
}

const CMT_TYPES: PoType[] = ['material', 'sewing', 'bordir', 'accessory']

function emptyRow(po_type: PoType): Row {
  return { po_type, vendor_id: '', amount: '', notes: '', material_id: '', qty: '', unit_price: '' }
}

export default function IssueForm({
  ppoId,
  scheme,
  vendors,
  materials,
}: {
  ppoId: string
  scheme: 'fob' | 'cmt'
  vendors: VendorOption[]
  materials: MatOption[]
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(
    scheme === 'fob' ? [emptyRow('finished')] : CMT_TYPES.map((t) => emptyRow(t))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function onSave() {
    setError(null)
    const children: PpoChildInput[] = []
    for (const r of rows) {
      if (!r.vendor_id) { setError('Setiap baris wajib pilih vendor'); return }
      const amount = Number(r.amount || '0')
      if (!Number.isFinite(amount) || amount < 0) { setError('Nilai PO harus angka ≥ 0'); return }
      const child: PpoChildInput = {
        po_type: r.po_type,
        vendor_id: r.vendor_id,
        amount,
        notes: r.notes.trim() || undefined,
      }
      if (r.po_type === 'material' && r.material_id) {
        child.material_id = r.material_id
        if (r.qty) {
          const qty = Number(r.qty)
          if (!Number.isFinite(qty) || qty <= 0) { setError('Qty bahan harus > 0'); return }
          child.qty = qty
        }
        if (r.unit_price) {
          const price = Number(r.unit_price)
          if (!Number.isFinite(price) || price < 0) { setError('Harga bahan harus angka ≥ 0'); return }
          child.unit_price = price
        }
      }
      children.push(child)
    }
    if (!children.length) { setError('Minimal satu baris'); return }
    setSaving(true)
    const res = await issuePpoPos({ ppo_id: ppoId, children })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setDone(true)
    router.refresh()
  }

  if (done) return null

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>
        Terbitkan PO — {scheme === 'fob' ? 'FOB (1 vendor)' : 'CMT (per proses)'}
      </div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}

      {rows.map((r, i) => (
        <div key={i} className="vb-card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: scheme === 'cmt' ? '1fr 1.4fr 1fr 30px' : '1.4fr 1fr', gap: 8, marginBottom: r.po_type === 'material' ? 8 : 0, alignItems: 'center' }}>
            {scheme === 'cmt' ? (
              <select className="vb-input" value={r.po_type} onChange={(e) => setRow(i, { po_type: e.target.value as PoType })}>
                {CMT_TYPES.map((t) => <option key={t} value={t}>{PO_TYPE_LABEL[t]}</option>)}
              </select>
            ) : (
              <div className="vb-label" style={{ margin: 0, alignSelf: 'center' }}>{PO_TYPE_LABEL['finished']}</div>
            )}
            <select className="vb-input" value={r.vendor_id} onChange={(e) => setRow(i, { vendor_id: e.target.value })}>
              <option value="">Pilih vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input className="vb-input" placeholder="Nilai PO" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
            {scheme === 'cmt' && (
              <button type="button" className="vb-btn" style={{ padding: 0 }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>×</button>
            )}
          </div>

          {r.po_type === 'material' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 120px', gap: 8, marginBottom: 8 }}>
              <select className="vb-input" value={r.material_id} onChange={(e) => setRow(i, { material_id: e.target.value })}>
                <option value="">(opsional) Pilih bahan…</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
              </select>
              <input className="vb-input" placeholder="Qty" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
              <input className="vb-input" placeholder="Harga/unit" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} />
            </div>
          )}

          <input className="vb-input" placeholder="Catatan (opsional)" value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })} />
        </div>
      ))}

      {scheme === 'cmt' && (
        <button type="button" className="vb-btn" style={{ marginBottom: 12 }}
          onClick={() => setRows((rs) => [...rs, emptyRow('material')])}>+ Baris</button>
      )}

      <div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Menerbitkan…' : 'Terbitkan PO'}
        </button>
      </div>
    </div>
  )
}
