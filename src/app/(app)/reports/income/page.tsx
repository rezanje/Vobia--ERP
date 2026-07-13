import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

export default async function IncomePage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('account_balances').select('*').order('account_code')
  const all = rows ?? []
  // pendapatan: natural = -balance (credit-normal). contra retur (debit-normal) becomes negative → reduces.
  const pendapatan = all.filter((r) => r.account_type === 'pendapatan').map((r) => ({ name: r.account_name ?? "", amount: -Number(r.balance) }))
  const beban = all.filter((r) => r.account_type === 'beban').map((r) => ({ name: r.account_name ?? "", amount: Number(r.balance) }))
  const totalPendapatan = pendapatan.reduce((s, r) => s + r.amount, 0)
  const totalBeban = beban.reduce((s, r) => s + r.amount, 0)
  const laba = totalPendapatan - totalBeban

  const Section = ({ title, items, total }: { title: string; items: { name: string; amount: number }[]; total: number }) => (
    <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>{title}</div>
      {items.filter((i) => i.amount !== 0).map((i) => (
        <div key={i.name} className="vb-row" style={{ gridTemplateColumns: '1fr 150px' }}>
          <div style={{ fontSize: 12.5 }}>{i.name}</div>
          <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(i.amount)}</div>
        </div>
      ))}
      <div className="vb-row" style={{ gridTemplateColumns: '1fr 150px', borderTop: '1px solid var(--vb-border)', fontWeight: 600 }}>
        <div>Total {title}</div><div className="vb-mono" style={{ textAlign: 'right' }}>{rp(total)}</div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Laba-Rugi</h1>
        <div className="vb-sub">Pendapatan − Beban</div>
      </div>
      <Section title="Pendapatan" items={pendapatan} total={totalPendapatan} />
      <Section title="Beban" items={beban} total={totalBeban} />
      <div className="vb-card" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>Laba Bersih</div>
        <div className="vb-mono vb-accent" style={{ fontSize: 18, fontWeight: 600, color: laba >= 0 ? '#93d6a1' : 'var(--vb-danger)' }}>{rp(laba)}</div>
      </div>
    </div>
  )
}
