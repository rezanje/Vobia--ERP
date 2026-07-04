'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { transitionStage } from '@/lib/production/actions'
import { nextStages } from '@/lib/production/stages'
import { STAGE_META } from '@/lib/ui'

const FLOW = ['trial', 'mass_production', 'qc', 'completed']

export default function StageButtons({ poId, stage }: { poId: string; stage: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const options = nextStages(stage)
  const currentIndex = FLOW.indexOf(stage)

  async function go(next: string) {
    setError(null); setBusy(true)
    const res = await transitionStage({ po_id: poId, next_stage: next })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  if (stage === 'canceled') {
    return (
      <div style={{ border: '1px solid #5a3434', background: 'rgba(255,155,155,.07)', color: 'var(--vb-danger)', padding: '12px 16px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
        Order produksi ini dibatalkan.
      </div>
    )
  }

  return (
    <div className="vb-card" style={{ padding: '18px 20px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {FLOW.map((s, i) => {
          const meta = STAGE_META[s]
          const reached = i <= currentIndex
          const isCurrent = i === currentIndex
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ width: 40, height: 2, background: reached ? 'var(--vb-accent)' : 'var(--vb-border2)', margin: '0 10px' }} />}
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: reached ? meta.c : 'var(--vb-border2)', border: `2px solid ${reached ? meta.c : 'var(--vb-border2)'}`, flex: 'none' }} />
              <div style={{ marginLeft: 8, fontSize: 12.5, fontWeight: isCurrent ? 600 : 400, color: reached ? 'var(--vb-text)' : 'var(--vb-muted)' }}>{meta.label}</div>
            </div>
          )
        })}
      </div>
      {options.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {options.map((s) => {
            const meta = STAGE_META[s]
            return (
              <button key={s} type="button" disabled={busy} onClick={() => go(s)}
                style={{ background: meta.bg, color: meta.c, border: `1px solid ${meta.c}`, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                → {meta.label}
              </button>
            )
          })}
        </div>
      )}
      {error && <div className="vb-danger" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
