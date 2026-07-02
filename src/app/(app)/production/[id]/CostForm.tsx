'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addCostEntry } from '@/lib/costing/actions'

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
    if (!(a > 0)) { setError('Amount must be > 0'); return }
    setSaving(true)
    const res = await addCostEntry({ po_id: poId, cost_type: type, amount: a, note: note.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setAmount(''); setNote(''); router.refresh()
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <select className="vb-input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input className="vb-input" style={{ width: 140 }} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input className="vb-input" style={{ flex: 1, minWidth: 160 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add cost'}</button>
      {error && <div style={{ color: '#ff9b9b', width: '100%' }}>{error}</div>}
    </div>
  )
}
