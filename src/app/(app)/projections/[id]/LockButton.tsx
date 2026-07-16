'use client'
import { useState } from 'react'
import { lockProjection } from '@/lib/planning/actions'

export default function LockButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!confirming) { setConfirming(true); return }
    setSaving(true)
    setError(null)
    const res = await lockProjection(id)
    setSaving(false)
    if (res?.error) { setError(res.error); setConfirming(false) }
  }

  return (
    <div style={{ textAlign: 'right' }}>
      {error && <div className="vb-danger" style={{ marginBottom: 6, fontSize: 12.5 }}>{error}</div>}
      <button type="button" className="vb-btn" disabled={saving} onClick={onClick}>
        {saving ? 'Mengunci…' : confirming ? 'Yakin kunci? Klik lagi' : 'Kunci Proyeksi'}
      </button>
    </div>
  )
}
