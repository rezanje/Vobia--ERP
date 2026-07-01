'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProdLine } from '@/lib/production/actions'

type Props = { id: string; sku_code: string; qty_ordered: number; qty_received: number; reject_count: number }

export default function ProdLineRow({ id, sku_code, qty_ordered, qty_received, reject_count }: Props) {
  const router = useRouter()
  const [recv, setRecv] = useState(String(qty_received))
  const [rej, setRej] = useState(String(reject_count))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    await updateProdLine({ id, qty_received: parseInt(recv, 10) || 0, reject_count: parseInt(rej, 10) || 0 })
    setBusy(false)
    router.refresh()
  }

  return (
    <tr style={{ borderTop: '1px solid var(--vb-border)' }}>
      <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{sku_code}</td>
      <td style={{ padding: 12 }}>{qty_ordered}</td>
      <td style={{ padding: 12 }}><input className="vb-input" style={{ width: 80 }} value={recv} onChange={(e) => setRecv(e.target.value)} /></td>
      <td style={{ padding: 12 }}><input className="vb-input" style={{ width: 80 }} value={rej} onChange={(e) => setRej(e.target.value)} /></td>
      <td style={{ padding: 12 }}><button className="vb-btn-ghost" type="button" disabled={busy} onClick={save}>Save</button></td>
    </tr>
  )
}
