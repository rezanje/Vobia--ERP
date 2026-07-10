'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { postOpname } from '@/lib/stock/actions'
import { computeOpnameDeltas } from '@/lib/stock/opname'

type SkuOption = { id: string; sku_code: string }
type LocOption = { id: string; name: string }
// balancesByLoc: location_id -> (sku_id -> balance)
type BalMap = Record<string, Record<string, number>>

export default function OpnameForm({
  skus, locations, balancesByLoc,
}: { skus: SkuOption[]; locations: LocOption[]; balancesByLoc: BalMap }) {
  const router = useRouter()
  const [locId, setLocId] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const balances = useMemo(
    () => skus.map((s) => ({ sku_id: s.id, balance: (locId && balancesByLoc[locId]?.[s.id]) || 0 })),
    [skus, locId, balancesByLoc],
  )

  async function onSave() {
    setError(null)
    if (!locId) { setError('Pilih lokasi'); return }
    const countRows = Object.entries(counts)
      .filter(([, v]) => v.trim() !== '')
      .map(([sku_id, v]) => ({ sku_id, counted: parseInt(v, 10) }))
      .filter((c) => Number.isInteger(c.counted) && c.counted >= 0)
    const deltas = computeOpnameDeltas(countRows, balances)
    if (!deltas.length) { setError('Tidak ada selisih untuk diposting'); return }
    setSaving(true)
    const res = await postOpname({ location_id: locId, deltas })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setCounts({}); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Stok Opname</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ marginBottom: 12, maxWidth: 260 }}>
        <label className="vb-label">Lokasi</label>
        <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
          <option value="">Pilih lokasi…</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 90px 110px' }}>
        <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Sistem</div><div style={{ textAlign: 'right' }}>Hitung fisik</div>
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {skus.map((s) => {
          const sys = (locId && balancesByLoc[locId]?.[s.id]) || 0
          return (
            <div key={s.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 90px 110px', alignItems: 'center' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{s.sku_code}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{sys}</div>
              <input
                className="vb-input"
                style={{ textAlign: 'right', height: 30 }}
                placeholder={String(sys)}
                value={counts[s.id] ?? ''}
                onChange={(e) => setCounts((c) => ({ ...c, [s.id]: e.target.value }))}
              />
            </div>
          )
        })}
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12 }}>
        {saving ? 'Memposting…' : 'Posting Selisih'}
      </button>
    </div>
  )
}
