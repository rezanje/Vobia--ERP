'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { rp } from '@/lib/ui'
import { setOvertime } from '@/lib/hr/actions'

type Slip = { id: string; run_id: string; name: string; base: number; tunjangan: number; overtime: number; potongan: number; net: number }

export default function PayslipRow({ slip, editable }: { slip: Slip; editable: boolean }) {
  const router = useRouter()
  const [ot, setOt] = useState(String(slip.overtime || ''))
  const [saving, setSaving] = useState(false)
  const dirty = (Number(ot) || 0) !== slip.overtime

  async function save() {
    setSaving(true)
    const res = await setOvertime({ payslip_id: slip.id, run_id: slip.run_id, overtime: Number(ot) || 0 })
    setSaving(false)
    if (!(res && 'error' in res)) router.refresh()
  }

  return (
    <div className="vb-row" style={{ gridTemplateColumns: '1.3fr 110px 110px 100px 100px 120px 60px', alignItems: 'center' }}>
      <div style={{ fontWeight: 500, fontSize: 12.5 }}>{slip.name}</div>
      <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(slip.base)}</div>
      <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(slip.tunjangan)}</div>
      <div style={{ textAlign: 'right' }}>
        {editable ? (
          <input className="vb-input" style={{ height: 28, textAlign: 'right', width: 90 }} value={ot}
            onChange={(e) => setOt(e.target.value)} onBlur={() => dirty && save()} placeholder="0" disabled={saving} />
        ) : <span className="vb-mono">{rp(slip.overtime)}</span>}
      </div>
      <div className="vb-mono" style={{ textAlign: 'right', color: '#eda06a' }}>{rp(slip.potongan)}</div>
      <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600 }}>{rp(slip.net)}</div>
      <div style={{ textAlign: 'right' }}>
        <Link href={`/payroll/${slip.run_id}/slip/${slip.id}`} className="vb-muted" style={{ fontSize: 11.5 }}>Slip</Link>
      </div>
    </div>
  )
}
