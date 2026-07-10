'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { receivePurchase } from '@/lib/purchasing/actions'

type Line = { id: string; material_code: string; qty_ordered: number; unit_price: number; qty_received: number }

export default function ReceiveForm({ poId, lines, disabled }: { poId: string; lines: Line[]; disabled: boolean }) {
  const router = useRouter()
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onReceive() {
    setError(null)
    const receipts: { line_id: string; qty: number }[] = []
    for (const l of lines) {
      const raw = qtys[l.id]
      if (!raw || !raw.trim()) continue
      const q = Number(raw)
      if (!Number.isFinite(q) || q <= 0) { setError('Qty terima harus > 0'); return }
      const remaining = l.qty_ordered - l.qty_received
      if (q > remaining) { setError(`Qty terima ${l.material_code} melebihi sisa ${remaining}`); return }
      receipts.push({ line_id: l.id, qty: q })
    }
    if (!receipts.length) { setError('Isi minimal satu qty terima'); return }
    setSaving(true)
    const res = await receivePurchase({ po_id: poId, receipts })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQtys({}); router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden' }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Penerimaan</div>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 90px 90px 90px 110px' }}>
        <div>Bahan</div><div style={{ textAlign: 'right' }}>Order</div><div style={{ textAlign: 'right' }}>Diterima</div><div style={{ textAlign: 'right' }}>Sisa</div><div>Terima</div>
      </div>
      {lines.map((l) => {
        const remaining = l.qty_ordered - l.qty_received
        return (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 90px 90px 90px 110px', alignItems: 'center' }}>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.material_code}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{l.qty_ordered}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{l.qty_received}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{remaining}</div>
            <input className="vb-input" style={{ height: 30, textAlign: 'right' }} disabled={disabled || remaining <= 0}
              placeholder={String(remaining)} value={qtys[l.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))} />
          </div>
        )
      })}
      {!disabled && (
        <div style={{ padding: 12 }}>
          <button className="vb-btn" type="button" disabled={saving} onClick={onReceive}>{saving ? 'Memproses…' : 'Terima Bahan'}</button>
        </div>
      )}
    </div>
  )
}
