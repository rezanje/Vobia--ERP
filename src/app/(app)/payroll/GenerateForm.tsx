'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generatePayroll } from '@/lib/hr/actions'

export default function GenerateForm() {
  const router = useRouter()
  const [period, setPeriod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onGen() {
    setError(null)
    if (!/^\d{4}-\d{2}$/.test(period)) { setError('Format periode: YYYY-MM (mis. 2026-07)'); return }
    setBusy(true)
    const res = await generatePayroll(period)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.push(`/payroll/${res.id}`)
  }

  return (
    <div className="vb-card" style={{ padding: 16 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Proses Gaji Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <label className="vb-label">Periode (bulan)</label>
      <input className="vb-input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
      <div className="vb-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Menarik semua karyawan aktif & menghitung gaji sesuai komponen.</div>
      <button className="vb-btn" type="button" disabled={busy} onClick={onGen} style={{ marginTop: 14, width: '100%' }}>
        {busy ? 'Memproses…' : 'Proses Gaji'}
      </button>
    </div>
  )
}
