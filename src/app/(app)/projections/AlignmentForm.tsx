'use client'
import { useState } from 'react'
import { createProjection, type ProjectionLineInput } from '@/lib/planning/actions'

type StyleOption = { id: string; code: string; name: string }
type PeriodData = { period: string; salesByStyle: Record<string, number>; opsByStyle: Record<string, number> }
type NewProductOption = { id: string; name: string; style_id: string; agreed_qty: number }

export default function AlignmentForm({ periods, styles, newProducts, canWrite }: { periods: PeriodData[]; styles: StyleOption[]; newProducts: NewProductOption[]; canWrite: boolean }) {
  const [period, setPeriod] = useState('')
  const [finalQty, setFinalQty] = useState<Record<string, string>>({})
  const [npChecked, setNpChecked] = useState<Record<string, boolean>>({})
  const [npQty, setNpQty] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const styleName = new Map(styles.map((s) => [s.id, `${s.code} · ${s.name}`]))
  const current = periods.find((p) => p.period === period)
  const styleIds = current ? Array.from(new Set([...Object.keys(current.salesByStyle), ...Object.keys(current.opsByStyle)])) : []

  function selectPeriod(p: string) {
    setPeriod(p)
    setError(null)
    const pd = periods.find((x) => x.period === p)
    const init: Record<string, string> = {}
    if (pd) {
      const ids = new Set([...Object.keys(pd.salesByStyle), ...Object.keys(pd.opsByStyle)])
      ids.forEach((id) => {
        const v = pd.opsByStyle[id] ?? pd.salesByStyle[id] ?? 0
        init[id] = String(v)
      })
    }
    setFinalQty(init)
    const q: Record<string, string> = {}
    newProducts.forEach((np) => { q[np.id] = String(np.agreed_qty) })
    setNpQty(q)
    setNpChecked({})
  }

  async function onSave() {
    setError(null)
    if (!period) { setError('Pilih periode'); return }
    const lines: ProjectionLineInput[] = []
    for (const id of styleIds) {
      const q = Number(finalQty[id] ?? '0')
      if (Number.isFinite(q) && q > 0) lines.push({ style_id: id, qty: q, kind: 'regular' })
    }
    for (const np of newProducts) {
      if (!npChecked[np.id]) continue
      const q = Number(npQty[np.id] ?? '0')
      if (!Number.isFinite(q) || q <= 0) continue
      // projection_lines has unique (tenant_id, projection_id, style_id) — if a checked
      // new product shares its style_id with a regular forecast line, replace that line
      // in place with the seasonal_new one instead of pushing a duplicate (which would
      // otherwise crash createProjection with a unique-constraint violation).
      const existingIdx = lines.findIndex((l) => l.style_id === np.style_id)
      const seasonalLine: ProjectionLineInput = { style_id: np.style_id, qty: q, kind: 'seasonal_new', new_product_id: np.id }
      if (existingIdx >= 0) lines[existingIdx] = seasonalLine
      else lines.push(seasonalLine)
    }
    if (!lines.length) { setError('Minimal satu baris dengan qty > 0'); return }
    setSaving(true)
    const res = await createProjection({ period, lines })
    setSaving(false)
    if (res?.error) setError(res.error)
    // success → server action redirects ke /projections/[id]
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Alignment → Proyeksi</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ marginBottom: 12 }}>
        <label className="vb-label">Periode</label>
        <select className="vb-input" value={period} onChange={(e) => selectPeriod(e.target.value)}>
          <option value="">Pilih periode…</option>
          {periods.map((p) => <option key={p.period} value={p.period}>{p.period}</option>)}
        </select>
      </div>

      {period && (
        <>
          <label className="vb-label">Style (Sales vs Ops)</label>
          <div style={{ marginBottom: 12 }}>
            {!styleIds.length ? (
              <div className="vb-empty">Tidak ada baris forecast untuk periode ini.</div>
            ) : (
              <div className="vb-card" style={{ overflow: 'hidden' }}>
                <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 70px 70px 90px' }}>
                  <div>Style</div><div>Sales</div><div>Ops</div><div>Final</div>
                </div>
                {styleIds.map((id) => (
                  <div key={id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 70px 70px 90px' }}>
                    <div style={{ fontSize: 12.5 }}>{styleName.get(id) ?? id}</div>
                    <div className="vb-muted" style={{ fontSize: 12.5 }}>{current?.salesByStyle[id] ?? '—'}</div>
                    <div className="vb-muted" style={{ fontSize: 12.5 }}>{current?.opsByStyle[id] ?? '—'}</div>
                    <input className="vb-input" value={finalQty[id] ?? ''} onChange={(e) => setFinalQty((f) => ({ ...f, [id]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {!!newProducts.length && (
            <div style={{ marginBottom: 12 }}>
              <label className="vb-label">Produk Baru (seasonal)</label>
              <div className="vb-card" style={{ overflow: 'hidden' }}>
                {newProducts.map((np) => (
                  <div key={np.id} className="vb-row" style={{ gridTemplateColumns: '24px 1.6fr 90px' }}>
                    <input type="checkbox" checked={!!npChecked[np.id]} onChange={(e) => setNpChecked((c) => ({ ...c, [np.id]: e.target.checked }))} />
                    <div style={{ fontSize: 12.5 }}>{np.name}</div>
                    <input className="vb-input" value={npQty[np.id] ?? ''} onChange={(e) => setNpQty((q) => ({ ...q, [np.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {canWrite ? (
            <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
              {saving ? 'Menyimpan…' : 'Buat Proyeksi'}
            </button>
          ) : (
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya tim Ops/Owner yang bisa membuat proyeksi. Anda bisa melihat perbandingan Sales vs Ops di atas.</div>
          )}
        </>
      )}
    </div>
  )
}
