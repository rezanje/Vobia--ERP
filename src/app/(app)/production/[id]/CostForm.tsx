'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addCostEntry } from '@/lib/costing/actions'
import { COST_LABELS } from '@/lib/ui'

const TYPES = ['material', 'cmt', 'overhead', 'other']

export default function CostForm({ poId }: { poId: string }) {
  const router = useRouter()
  const [type, setType] = useState('material')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const a = Number(amount)
    if (!(a > 0)) { setError('Jumlah harus > 0'); return }
    setSaving(true)
    const res = await addCostEntry({ po_id: poId, cost_type: type, amount: a, note: note.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setAmount(''); setNote(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Tambah Biaya</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Tipe</label>
          <select className="vb-input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{COST_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Jumlah (Rp)</label>
          <input className="vb-input" placeholder="5000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Catatan</label>
          <input className="vb-input" placeholder="Kain + aksesoris" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Tambah'}</button>
      </div>
    </div>
  )
}
