'use client'
import { useState } from 'react'
import { toggleSku } from '@/lib/products/actions'

export default function SkuToggle({ id, active }: { id: string; active: boolean }) {
  const [on, setOn] = useState(active)
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
