'use client'
import { useState } from 'react'
import { createForecast, type ForecastLineInput } from '@/lib/planning/actions'

type StyleOption = { id: string; code: string; name: string }
type Row = { style_id: string; qty: string; ito: string; stock_ratio: string }

const EMPTY_ROW: Row = { style_id: '', qty: '', ito: '', stock_ratio: '' }
const PERIOD_RE = /^\d{4}-Q[1-4]$/

export default function ForecastForm({ styles, role }: { styles: StyleOption[]; role: string | null }) {
  const locked = role === 'sales' ? 'sales' : role === 'ops' ? 'ops' : null
  const [kind, setKind] = useState<'sales' | 'ops'>(locked ?? 'sales')
  const [period, setPeriod] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const cols = kind === 'ops' ? '1.6fr 90px 90px 90px 30px' : '1.6fr 100px 30px'

  async function onSave() {
    setError(null)
    if (!PERIOD_RE.test(period)) { setError('Format periode harus YYYY-Qn, mis. 2026-Q3'); return }
    const lines: ForecastLineInput[] = []
    for (const r of rows) {
      if (!r.style_id) continue
      const q = Number(r.qty)
      if (!Number.isFinite(q) || q <= 0) continue
      const line: ForecastLineInput = { style_id: r.style_id, qty: q }
      if (kind === 'ops') {
        line.ito = r.ito.trim() ? Number(r.ito) : null
        line.stock_ratio = r.stock_ratio.trim() ? Number(r.stock_ratio) : null
      }
      lines.push(line)
    }
    if (!lines.length) { setError('Minimal satu baris dengan qty > 0'); return }
    setSaving(true)
    const res = await createForecast({ kind, period, notes: notes.trim(), lines })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setKind(locked ?? 'sales'); setPeriod(''); setNotes(''); setRows([{ ...EMPTY_ROW }])
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Forecast Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="vb-label">Jenis</label>
          {locked ? (
            <div className="vb-label" style={{ margin: 0, alignSelf: 'center' }}>{locked === 'sales' ? 'Sales' : 'Operasional'}</div>
          ) : (
            <select className="vb-input" value={kind} onChange={(e) => setKind(e.target.value as 'sales' | 'ops')}>
              <option value="sales">Sales</option>
              <option value="ops">Operasional</option>
            </select>
          )}
        </div>
        <div>
          <label className="vb-label">Periode</label>
          <input className="vb-input" placeholder="2026-Q3" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
      </div>

      <label className="vb-label">Baris style</label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginBottom: 6 }}>
          <select className="vb-input" value={r.style_id} onChange={(e) => setRow(i, { style_id: e.target.value })}>
            <option value="">Pilih style…</option>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
          <input className="vb-input" placeholder="Qty" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
          {kind === 'ops' && (
            <>
              <input className="vb-input" placeholder="ITO" value={r.ito} onChange={(e) => setRow(i, { ito: e.target.value })} />
              <input className="vb-input" placeholder="Stock Ratio" value={r.stock_ratio} onChange={(e) => setRow(i, { stock_ratio: e.target.value })} />
            </>
          )}
          <button type="button" className="vb-btn" style={{ padding: 0 }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>×</button>
        </div>
      ))}
      <button type="button" className="vb-btn" style={{ marginTop: 4, marginBottom: 12 }}
        onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW }])}>+ Baris</button>

      <div>
        <label className="vb-label">Catatan</label>
        <input className="vb-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12 }}>
        {saving ? 'Menyimpan…' : 'Buat Forecast'}
      </button>
    </div>
  )
}
