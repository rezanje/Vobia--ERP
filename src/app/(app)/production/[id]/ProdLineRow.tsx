'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProdLine } from '@/lib/production/actions'

type Props = { id: string; sku_code: string; qty_ordered: number; qty_received: number; reject_count: number; canWrite: boolean }

export default function ProdLineRow({ id, sku_code, qty_ordered, qty_received, reject_count, canWrite }: Props) {
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

  if (!canWrite) {
    return (
      <div className="vb-row" style={{ gridTemplateColumns: '1.5fr 90px 110px 100px 90px' }}>
        <div className="vb-mono" style={{ fontWeight: 500 }}>{sku_code}</div>
        <div className="vb-mono" style={{ textAlign: 'right' }}>{qty_ordered}</div>
        <div className="vb-mono">{qty_received}</div>
        <div className="vb-mono">{reject_count}</div>
        <div />
      </div>
    )
  }

  return (
    <div className="vb-row" style={{ gridTemplateColumns: '1.5fr 90px 110px 100px 90px' }}>
      <div className="vb-mono" style={{ fontWeight: 500 }}>{sku_code}</div>
      <div className="vb-mono" style={{ textAlign: 'right' }}>{qty_ordered}</div>
      <input className="vb-input" style={{ width: 84, padding: '6px 9px', fontSize: 12.5 }} value={recv} onChange={(e) => setRecv(e.target.value)} />
      <input className="vb-input" style={{ width: 74, padding: '6px 9px', fontSize: 12.5 }} value={rej} onChange={(e) => setRej(e.target.value)} />
      <button className="vb-btn-mini" type="button" disabled={busy} onClick={save}>Simpan</button>
    </div>
  )
}
