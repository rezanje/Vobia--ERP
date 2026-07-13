'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createEmployee } from '@/lib/hr/actions'

export default function EmployeeForm() {
  const router = useRouter()
  const [f, setF] = useState({ name: '', position: '', placement: '', base_salary: '', join_date: '', bank_account: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))

  async function onSave() {
    setError(null)
    if (!f.name.trim()) { setError('Nama wajib'); return }
    setSaving(true)
    const res = await createEmployee({ ...f, base_salary: Number(f.base_salary) || 0 })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setF({ name: '', position: '', placement: '', base_salary: '', join_date: '', bank_account: '' }); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Karyawan Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <label className="vb-label">Nama</label>
      <input className="vb-input" value={f.name} onChange={(e) => set('name', e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Jabatan</label>
      <input className="vb-input" placeholder="mis. Penjahit, Admin" value={f.position} onChange={(e) => set('position', e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Penempatan</label>
      <input className="vb-input" placeholder="mis. Lini Jahit A" value={f.placement} onChange={(e) => set('placement', e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Gaji Pokok</label>
      <input className="vb-input" type="number" placeholder="0" value={f.base_salary} onChange={(e) => set('base_salary', e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Tanggal Masuk</label>
      <input className="vb-input" type="date" value={f.join_date} onChange={(e) => set('join_date', e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>No. Rekening</label>
      <input className="vb-input" value={f.bank_account} onChange={(e) => set('bank_account', e.target.value)} />
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 14, width: '100%' }}>
        {saving ? 'Menyimpan…' : 'Simpan Karyawan'}
      </button>
    </div>
  )
}
