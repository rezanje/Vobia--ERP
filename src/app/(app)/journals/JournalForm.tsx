'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { rp } from '@/lib/ui'
import { postManualJournal } from '@/lib/accounting/actions'

type Acc = { code: string; name: string }
type Row = { account_code: string; debit: string; credit: string }

const emptyRow = (): Row => ({ account_code: '', debit: '', credit: '' })

export default function JournalForm({ accounts }: { accounts: Acc[] }) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const totD = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0)
  const totC = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0)
  const balanced = totD === totC && totD > 0

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function onSave() {
    setError(null)
    const lines = rows
      .filter((r) => r.account_code && (Number(r.debit) > 0 || Number(r.credit) > 0))
      .map((r) => ({ account_code: r.account_code, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }))
    if (lines.length < 2) { setError('Minimal 2 baris terisi'); return }
    if (totD !== totC) { setError('Debit & kredit harus sama'); return }
    setSaving(true)
    const res = await postManualJournal({ date, memo, lines })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setRows([emptyRow(), emptyRow()]); setMemo(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Jurnal Manual</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <label className="vb-label">Tanggal</label>
      <input className="vb-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Keterangan</label>
      <input className="vb-input" placeholder="Keterangan jurnal" value={memo} onChange={(e) => setMemo(e.target.value)} />

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 6, fontSize: 11, color: 'var(--vb-muted)' }}>
        <div>Akun</div><div style={{ textAlign: 'right' }}>Debit</div><div style={{ textAlign: 'right' }}>Kredit</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 6 }}>
          <select className="vb-input" style={{ height: 32 }} value={r.account_code} onChange={(e) => setRow(i, { account_code: e.target.value })}>
            <option value="">Pilih akun…</option>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
          </select>
          <input className="vb-input" style={{ height: 32, textAlign: 'right' }} placeholder="0" value={r.debit}
            onChange={(e) => setRow(i, { debit: e.target.value, credit: '' })} />
          <input className="vb-input" style={{ height: 32, textAlign: 'right' }} placeholder="0" value={r.credit}
            onChange={(e) => setRow(i, { credit: e.target.value, debit: '' })} />
        </div>
      ))}
      <button className="vb-btn-line" type="button" style={{ marginTop: 8 }} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
        + Tambah baris
      </button>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
        <span className="vb-muted">Debit {rp(totD)} · Kredit {rp(totC)}</span>
        <span style={{ color: balanced ? '#93d6a1' : 'var(--vb-danger)', fontWeight: 600 }}>{balanced ? 'Seimbang' : 'Belum seimbang'}</span>
      </div>
      <button className="vb-btn" type="button" disabled={saving || !balanced} onClick={onSave} style={{ marginTop: 12, width: '100%' }}>
        {saving ? 'Menyimpan…' : 'Simpan Jurnal'}
      </button>
    </div>
  )
}
