'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPayComponent } from '@/lib/hr/actions'

export default function PayComponentForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('tunjangan')
  const [calc, setCalc] = useState('nominal')
  const [value, setValue] = useState('')
  const [isTax, setIsTax] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama wajib'); return }
    setSaving(true)
    const res = await createPayComponent({ name: name.trim(), kind, calc, value: Number(value) || 0, is_tax: kind === 'potongan' && isTax })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setValue(''); setIsTax(false); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Komponen Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <label className="vb-label">Nama</label>
      <input className="vb-input" placeholder="mis. Tunjangan Transport" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="vb-label" style={{ marginTop: 10 }}>Jenis</label>
      <select className="vb-input" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="tunjangan">Tunjangan (nambah)</option>
        <option value="potongan">Potongan (ngurang)</option>
      </select>
      <label className="vb-label" style={{ marginTop: 10 }}>Cara hitung</label>
      <select className="vb-input" value={calc} onChange={(e) => setCalc(e.target.value)}>
        <option value="nominal">Nominal (Rp)</option>
        <option value="persen">Persen dari gaji pokok (%)</option>
      </select>
      <label className="vb-label" style={{ marginTop: 10 }}>Nilai</label>
      <input className="vb-input" type="number" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} />
      {kind === 'potongan' && (
        <label style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={isTax} onChange={(e) => setIsTax(e.target.checked)} />
          Ini pajak (masuk Hutang Pajak)
        </label>
      )}
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 14, width: '100%' }}>
        {saving ? 'Menyimpan…' : 'Simpan Komponen'}
      </button>
    </div>
  )
}
