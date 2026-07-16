'use client'
import { useState } from 'react'
import { createPcb, type PcbLineInput } from '@/lib/ppic/actions'
import { rp } from '@/lib/ui'

type PrefillRow = { style_id: string; label: string; target_sales: number; ending_stock: number }
type Row = { style_id: string; label: string; target_sales: string; ending_stock: string; unit_cost: string }

export default function PcbForm({ projectionId, quarter, rows: prefill }: { projectionId: string; quarter: string; rows: PrefillRow[] }) {
  const [quarterVal, setQuarterVal] = useState(quarter)
  const [rows, setRows] = useState<Row[]>(
    prefill.map((r) => ({ style_id: r.style_id, label: r.label, target_sales: String(r.target_sales), ending_stock: String(r.ending_stock), unit_cost: '0' }))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const computed = rows.map((r) => {
    const target = Number(r.target_sales) || 0
    const ending = Number(r.ending_stock) || 0
    const cost = Number(r.unit_cost) || 0
    const kebutuhan = target + ending
    return { kebutuhan, subtotal: kebutuhan * cost }
  })
  const total = computed.reduce((s, c) => s + c.subtotal, 0)

  async function onSave() {
    setError(null)
    if (!/^\d{4}-Q[1-4]$/.test(quarterVal.trim())) { setError('Format kuartal harus YYYY-Qn, mis. 2026-Q3'); return }
    if (!rows.length) { setError('Tidak ada baris style'); return }
    const lines: PcbLineInput[] = []
    for (const r of rows) {
      const target = Number(r.target_sales), ending = Number(r.ending_stock), cost = Number(r.unit_cost)
      if (!Number.isFinite(target) || target < 0) { setError('Target sales harus angka ≥ 0'); return }
      if (!Number.isFinite(ending) || ending < 0) { setError('Ending stock harus angka ≥ 0'); return }
      if (!Number.isFinite(cost) || cost < 0) { setError('Biaya/unit harus angka ≥ 0'); return }
      lines.push({ style_id: r.style_id, target_sales: target, ending_stock: ending, unit_cost: cost })
    }
    setSaving(true)
    const res = await createPcb({ projection_id: projectionId, quarter: quarterVal.trim(), lines })
    setSaving(false)
    if (res?.error) { setError(res.error); setSaving(false) }
    // success → server action redirects
  }

  return (
    <div>
      <div style={{ marginBottom: 12, maxWidth: 220 }}>
        <label className="vb-label">Kuartal</label>
        <input className="vb-input" placeholder="2026-Q3" value={quarterVal} onChange={(e) => setQuarterVal(e.target.value)} />
      </div>

      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}

      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 110px 110px 110px 110px 120px' }}>
          <div>Style</div><div>Target Sales</div><div>Ending Stock</div><div>Biaya/unit</div><div>Kebutuhan</div><div>Subtotal</div>
        </div>
        {!rows.length ? (
          <div className="vb-empty">Tidak ada baris style dari proyeksi ini.</div>
        ) : rows.map((r, i) => (
          <div key={r.style_id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 110px 110px 110px 110px 120px', alignItems: 'center' }}>
            <div style={{ fontSize: 12.5 }}>{r.label}</div>
            <input className="vb-input" value={r.target_sales} onChange={(e) => setRow(i, { target_sales: e.target.value })} />
            <input className="vb-input" value={r.ending_stock} onChange={(e) => setRow(i, { ending_stock: e.target.value })} />
            <input className="vb-input" value={r.unit_cost} onChange={(e) => setRow(i, { unit_cost: e.target.value })} />
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{computed[i].kebutuhan}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{rp(computed[i].subtotal)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <div className="vb-sub">Total nilai: <span className="vb-mono">{rp(total)}</span></div>
        <button className="vb-btn" type="button" disabled={saving || !rows.length} onClick={onSave}>
          {saving ? 'Menyimpan…' : 'Buat PCB'}
        </button>
      </div>
    </div>
  )
}
