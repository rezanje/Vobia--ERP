import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

export default async function TrialBalancePage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('account_balances').select('*').order('account_code')
  const active = (rows ?? []).filter((r) => Number(r.total_debit) !== 0 || Number(r.total_credit) !== 0)
  let sumD = 0, sumC = 0
  const view = active.map((r) => {
    const bal = Number(r.balance)
    const d = bal >= 0 ? bal : 0
    const c = bal < 0 ? -bal : 0
    sumD += d; sumC += c
    return { code: r.account_code, name: r.account_name, d, c }
  })
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Neraca Saldo</h1>
        <div className="vb-sub">Saldo tiap akun · total debit = total kredit</div>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden', maxWidth: 720 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '90px 1fr 130px 130px' }}>
          <div>Kode</div><div>Akun</div><div style={{ textAlign: 'right' }}>Debit</div><div style={{ textAlign: 'right' }}>Kredit</div>
        </div>
        {!view.length ? <div className="vb-empty">Belum ada aktivitas.</div> : view.map((r) => (
          <div key={r.code} className="vb-row" style={{ gridTemplateColumns: '90px 1fr 130px 130px' }}>
            <div className="vb-mono" style={{ fontSize: 12 }}>{r.code}</div>
            <div style={{ fontSize: 12.5 }}>{r.name}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{r.d ? rp(r.d) : '—'}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{r.c ? rp(r.c) : '—'}</div>
          </div>
        ))}
        <div className="vb-row" style={{ gridTemplateColumns: '90px 1fr 130px 130px', borderTop: '1px solid var(--vb-border)', fontWeight: 600 }}>
          <div></div><div>Total</div>
          <div className="vb-mono vb-accent" style={{ textAlign: 'right' }}>{rp(sumD)}</div>
          <div className="vb-mono vb-accent" style={{ textAlign: 'right' }}>{rp(sumC)}</div>
        </div>
      </div>
      {sumD !== sumC && <div className="vb-danger" style={{ marginTop: 10 }}>Tidak seimbang — ada masalah data.</div>}
    </div>
  )
}
