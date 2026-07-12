'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { issueMaterialToPo } from '@/lib/production/issue'

type Suggestion = { material_id: string; material_code: string; qty: number }
type LocOption = { id: string; name: string }

export default function IssueSection({ prodPoId, suggestions, locations, disabled }: { prodPoId: string; suggestions: Suggestion[]; locations: LocOption[]; disabled?: boolean }) {
  const router = useRouter()
  const [locId, setLocId] = useState('')
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.material_id, String(s.qty)])),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onIssue() {
    setError(null)
    const issues: { material_id: string; qty: number }[] = []
    for (const s of suggestions) {
      const raw = qtys[s.material_id]
      if (!raw || !raw.trim()) continue
      const q = Number(raw)
      if (!Number.isFinite(q) || q <= 0) { setError(`Qty ${s.material_code} tidak valid`); return }
      issues.push({ material_id: s.material_id, qty: q })
    }
    if (!issues.length) { setError('Isi minimal satu qty'); return }
    setSaving(true)
    const res = await issueMaterialToPo({ prod_po_id: prodPoId, issues, location_id: locId || undefined })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden', marginTop: 12 }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Issue Bahan ke Vendor (CMT)</div>
      {disabled ? (
        <div className="vb-empty">ACC order dulu sebelum keluarin bahan.</div>
      ) : (
        <IssueBody />
      )}
    </div>
  )

  function IssueBody() {
    return (
      <>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      {!suggestions.length ? (
        <div className="vb-empty">Style ini belum punya BOM — tambah di halaman style bila CMT.</div>
      ) : (
        <>
          <div style={{ padding: '0 16px 10px', maxWidth: 260 }}>
            <label className="vb-label">Ambil dari lokasi</label>
            <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
              <option value="">Default</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 130px' }}>
            <div>Bahan</div><div style={{ textAlign: 'right' }}>Qty issue (saran BOM)</div>
          </div>
          {suggestions.map((s) => (
            <div key={s.material_id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 130px', alignItems: 'center' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{s.material_code}</div>
              <input className="vb-input" style={{ height: 30, textAlign: 'right' }}
                value={qtys[s.material_id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [s.material_id]: e.target.value }))} />
            </div>
          ))}
          <div style={{ padding: 12 }}>
            <button className="vb-btn" type="button" disabled={saving} onClick={onIssue}>{saving ? 'Memproses…' : 'Issue Bahan'}</button>
          </div>
        </>
      )}
      </>
    )
  }
}
