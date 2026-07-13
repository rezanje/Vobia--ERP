'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postOpeningBalance } from '@/lib/accounting/actions'

export default function OpeningBalanceButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div style={{ textAlign: 'right' }}>
      <button className="vb-btn-ghost" type="button" disabled={busy} onClick={async () => {
        setMsg(null); setBusy(true)
        const res = await postOpeningBalance()
        setBusy(false)
        if (res?.error) setMsg(res.error); else router.refresh()
      }}>{busy ? 'Memproses…' : 'Saldo Awal'}</button>
      {msg && <div style={{ color: 'var(--vb-danger)', fontSize: 11.5, marginTop: 4, maxWidth: 220 }}>{msg}</div>}
    </div>
  )
}
