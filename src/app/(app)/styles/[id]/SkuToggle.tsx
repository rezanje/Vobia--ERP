'use client'
import { useState } from 'react'
import { toggleSku } from '@/lib/products/actions'

export default function SkuToggle({ id, active, canWrite }: { id: string; active: boolean; canWrite: boolean }) {
  const [on, setOn] = useState(active)
  if (!canWrite) {
    return <span style={{ fontSize: 11.5, color: on ? '#93d6a1' : 'var(--vb-muted)' }}>{on ? 'Aktif' : 'Nonaktif'}</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className={`vb-toggle ${on ? 'on' : 'off'}`} onClick={async () => {
        const next = !on
        setOn(next)
        await toggleSku(id, next)
      }}>
        <span className="vb-toggle-knob" />
      </button>
      <span style={{ fontSize: 11.5, color: on ? '#93d6a1' : 'var(--vb-muted)' }}>{on ? 'Aktif' : 'Nonaktif'}</span>
    </div>
  )
}
