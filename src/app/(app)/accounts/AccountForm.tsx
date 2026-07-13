'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAccount } from '@/lib/accounting/actions'

export default function AccountForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('aset')
  const [nb, setNb] = useState('debit')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!code.trim() || !name.trim()) { setError('Kode & nama wajib'); return }
    setSaving(true)
    const res = await createAccount({ code: code.trim(), name: name.trim(), type, normal_balance: nb })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setCode(''); setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Akun Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <label className="vb-label">Kode</label>
      <input className="vb-input" placeholder="6-1000" value={code} onChange={(e) => setCode(e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Nama</label>
      <input className="vb-input" placeholder="Nama akun" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Tipe</label>
      <select className="vb-input" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="aset">Aset</option><option value="kewajiban">Kewajiban</option>
        <option value="modal">Modal</option><option value="pendapatan">Pendapatan</option>
        <option value="beban">Beban</option>
      </select>
      <label className="vb-label" style={{ marginTop: 10 }}>Saldo normal</label>
      <select className="vb-input" value={nb} onChange={(e) => setNb(e.target.value)}>
        <option value="debit">Debit</option><option value="kredit">Kredit</option>
      </select>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 14, width: '100%' }}>
        {saving ? 'Menyimpan…' : 'Simpan Akun'}
      </button>
    </div>
  )
}
