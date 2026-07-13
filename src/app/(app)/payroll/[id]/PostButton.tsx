'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postPayroll } from '@/lib/hr/actions'

export default function PostButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div style={{ textAlign: 'right' }}>
      <button className="vb-btn" type="button" disabled={busy} onClick={async () => {
        setErr(null); setBusy(true)
        const res = await postPayroll(runId)
        setBusy(false)
        if (res?.error) setErr(res.error); else router.refresh()
      }}>{busy ? 'Memproses…' : 'Posting ke Buku'}</button>
      {err && <div style={{ color: 'var(--vb-danger)', fontSize: 11.5, marginTop: 4, maxWidth: 200 }}>{err}</div>}
    </div>
  )
}
