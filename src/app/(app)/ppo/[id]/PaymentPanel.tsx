'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addPoPayment, markPaymentPaid } from '@/lib/ppic/actions'
import { rp } from '@/lib/ui'

type PaymentKind = 'dp' | 'settlement' | 'full'
type PaymentRow = { id: string; kind: string; amount: number; status: string; paid_at: string | null }
type PoInfo = { id: string; po_type: string }

const KIND_LABEL: Record<string, string> = { dp: 'DP', settlement: 'Pelunasan', full: 'Penuh' }

export default function PaymentPanel({ ppoId, po, payments }: { ppoId: string; po: PoInfo; payments: PaymentRow[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<PaymentKind>('dp')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onAdd() {
    setError(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Jumlah harus > 0'); return }
    setBusy(true)
    const res = await addPoPayment({ ppo_id: ppoId, po_id: po.id, kind, amount: amt })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    setAmount('')
    router.refresh()
  }

  async function onMarkPaid(paymentId: string) {
    setError(null)
    setBusy(true)
    const res = await markPaymentPaid({ ppo_id: ppoId, payment_id: paymentId })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <div>
      {!payments.length ? (
        <div className="vb-muted" style={{ fontSize: 11.5 }}>Belum ada pembayaran.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {payments.map((p) => {
            const paid = p.status === 'paid'
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                <span>{KIND_LABEL[p.kind] ?? p.kind}</span>
                <span className="vb-mono">{rp(Number(p.amount))}</span>
                <span
                  className="vb-badge"
                  style={{
                    background: paid ? 'rgba(147,214,161,.13)' : 'rgba(227,196,110,.13)',
                    color: paid ? '#93d6a1' : '#e3c46e',
                  }}
                >
                  {paid ? 'Lunas' : 'Belum Bayar'}
                </span>
                {!paid && (
                  <button type="button" className="vb-btn" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy} onClick={() => onMarkPaid(p.id)}>
                    Tandai Lunas
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <div className="vb-danger" style={{ fontSize: 11, marginBottom: 4 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 4 }}>
        <select className="vb-input" style={{ fontSize: 11.5, padding: '2px 4px' }} value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
          <option value="dp">DP</option>
          <option value="settlement">Pelunasan</option>
          <option value="full">Penuh</option>
        </select>
        <input className="vb-input" style={{ fontSize: 11.5, padding: '2px 4px', width: 90 }} placeholder="Jumlah" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className="vb-btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={onAdd}>+</button>
      </div>

      {po.po_type === 'finished' && (
        <div className="vb-muted" style={{ fontSize: 10.5, marginTop: 4 }}>DP → Barang → Pelunasan</div>
      )}
    </div>
  )
}
