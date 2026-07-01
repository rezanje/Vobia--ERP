'use client'
import { useState } from 'react'
import { toggleSku } from '@/lib/products/actions'

export default function SkuToggle({ id, active }: { id: string; active: boolean }) {
  const [on, setOn] = useState(active)
  return (
    <span className={`vb-chip ${on ? 'on' : ''}`} onClick={async () => {
      const next = !on
      setOn(next)
      await toggleSku(id, next)
    }}>{on ? 'active' : 'inactive'}</span>
  )
}
