'use client'
import { useState } from 'react'
import { createPpo } from '@/lib/ppic/actions'

type LineOption = { style_id: string; label: string; supply_qty: number }

export default function PpoForm({ pcbId, lines }: { pcbId: string; lines: LineOption[] }) {
  const [styleId, setStyleId] = useState(lines[0]?.style_id ?? '')
  const [scheme, setScheme] = useState<'fob' | 'cmt'>('fob')
  const [qty, setQty] = useState(String(lines[0]?.supply_qty ?? ''))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function onStyleChange(id: string) {
    setStyleId(id)
    const line = lines.find((l) => l.style_id === id)
    if (line) setQty(String(line.supply_qty))
  }

  async function onSave() {
    setError(null)
    if (!styleId) { setError('Pilih style'); return }
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0) { setError('Qty harus > 0'); return }
    setSaving(true)
    const res = await createPpo({ pcb_id: pcbId, style_id: styleId, scheme, qty: q, notes: notes.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); setSaving(false) }
    // success → server action redirects
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Buat PPO</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      {!lines.length ? (
        <div className="vb-empty">Belum ada baris style di PCB ini.</div>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <label className="vb-label">Style</label>
            <select className="vb-input" value={styleId} onChange={(e) => onStyleChange(e.target.value)}>
              {lines.map((l) => <option key={l.style_id} value={l.style_id}>{l.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="vb-label">Skema</label>
            <select className="vb-input" value={scheme} onChange={(e) => setScheme(e.target.value as 'fob' | 'cmt')}>
              <option value="fob">FOB — beli jadi 1 vendor</option>
              <option value="cmt">CMT — pecah per proses</option>
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="vb-label">Qty</label>
            <input className="vb-input" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="vb-label">Catatan</label>
            <input className="vb-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
            {saving ? 'Menyimpan…' : 'Buat PPO'}
          </button>
        </>
      )}
    </div>
  )
}
