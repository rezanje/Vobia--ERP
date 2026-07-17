'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addBomLine, removeBomLine } from '@/lib/bom/actions'

type MatOption = { id: string; code: string; name: string }
type BomRow = { id: string; material_id: string; qty_per_unit: number }

export default function BomSection({ styleId, materials, rows, canWrite }: { styleId: string; materials: MatOption[]; rows: BomRow[]; canWrite: boolean }) {
  const router = useRouter()
  const [matId, setMatId] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const codeOf = new Map(materials.map((m) => [m.id, `${m.code} · ${m.name}`]))

  async function onAdd() {
    setError(null)
    const n = Number(qty)
    if (!matId) { setError('Pilih bahan'); return }
    if (!Number.isFinite(n) || n <= 0) { setError('Qty/unit harus > 0'); return }
    setSaving(true)
    const res = await addBomLine({ style_id: styleId, material_id: matId, qty_per_unit: n })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setMatId(''); setQty(''); router.refresh()
  }

  async function onRemove(id: string) {
    await removeBomLine(id, styleId); router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden', marginTop: 12 }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>BOM (Bahan per Unit)</div>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 120px 60px' }}>
        <div>Bahan</div><div style={{ textAlign: 'right' }}>Qty/unit</div><div></div>
      </div>
      {!rows.length ? (
        <div className="vb-empty">Belum ada BOM.</div>
      ) : rows.map((r) => (
        <div key={r.id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 120px 60px', alignItems: 'center' }}>
          <div style={{ fontSize: 12.5 }}>{codeOf.get(r.material_id) ?? r.material_id}</div>
          <div className="vb-mono" style={{ textAlign: 'right' }}>{r.qty_per_unit}</div>
          {canWrite ? (
            <button type="button" className="vb-btn" style={{ padding: '2px 8px' }} onClick={() => onRemove(r.id)}>×</button>
          ) : <div />}
        </div>
      ))}
      {canWrite && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 120px auto', gap: 8, padding: 12, alignItems: 'end' }}>
          <div>
            <label className="vb-label">Bahan</label>
            <select className="vb-input" value={matId} onChange={(e) => setMatId(e.target.value)}>
              <option value="">Pilih bahan…</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="vb-label">Qty/unit</label>
            <input className="vb-input" placeholder="1.25" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <button className="vb-btn" type="button" disabled={saving} onClick={onAdd} style={{ height: 37 }}>{saving ? '…' : 'Tambah'}</button>
        </div>
      )}
    </div>
  )
}
