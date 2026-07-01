'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { transitionStage } from '@/lib/production/actions'
import { nextStages } from '@/lib/production/stages'

export default function StageButtons({ poId, stage }: { poId: string; stage: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const options = nextStages(stage)

  async function go(next: string) {
    setError(null); setBusy(true)
    const res = await transitionStage({ po_id: poId, next_stage: next })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="vb-chip on">{stage}</span>
        {options.map((s) => (
          <button key={s} className="vb-btn-ghost" type="button" disabled={busy} onClick={() => go(s)}>→ {s}</button>
        ))}
      </div>
      {error && <div style={{ color: '#ff9b9b', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
