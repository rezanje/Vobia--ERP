import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'

export default async function BalanceSheetPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('account_balances').select('*').order('account_code')
  const all = rows ?? []
  const sumType = (t: string, sign: 1 | -1) => all.filter((r) => r.account_type === t).reduce((s, r) => s + sign * Number(r.balance), 0)

  const aset = all.filter((r) => r.account_type === 'aset').map((r) => ({ name: r.account_name ?? "", amount: Number(r.balance) }))
  const kewajiban = all.filter((r) => r.account_type === 'kewajiban').map((r) => ({ name: r.account_name ?? "", amount: -Number(r.balance) }))
  const modal = all.filter((r) => r.account_type === 'modal').map((r) => ({ name: r.account_name ?? "", amount: -Number(r.balance) }))

  const totalAset = sumType('aset', 1)
  const totalKewajiban = sumType('kewajiban', -1)
  const totalModal = sumType('modal', -1)
  const laba = -sumType('pendapatan', 1) - sumType('beban', 1)  // -sum(pend balance) - sum(beban balance)
  const totalEkuitas = totalModal + laba
  const balanced = Math.round(totalAset) === Math.round(totalKewajiban + totalEkuitas)

  const Block = ({ title, items }: { title: string; items: { name: string; amount: number }[] }) => (
    <>
      <div className="vb-row" style={{ gridTemplateColumns: '1fr 150px', fontWeight: 600, background: 'var(--vb-panel)' }}>
        <div>{title}</div><div></div>
      </div>
      {items.filter((i) => i.amount !== 0).map((i) => (
        <div key={i.name} className="vb-row" style={{ gridTemplateColumns: '1fr 150px' }}>
          <div style={{ fontSize: 12.5, paddingLeft: 12 }}>{i.name}</div>
          <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(i.amount)}</div>
        </div>
      ))}
    </>
  )

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Neraca</h1>
        <div className="vb-sub">Aset = Kewajiban + Modal</div>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        <Block title="Aset" items={aset} />
        <div className="vb-row" style={{ gridTemplateColumns: '1fr 150px', borderTop: '1px solid var(--vb-border)', fontWeight: 600 }}>
          <div>Total Aset</div><div className="vb-mono vb-accent" style={{ textAlign: 'right' }}>{rp(totalAset)}</div>
        </div>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        <Block title="Kewajiban" items={kewajiban} />
        <Block title="Modal" items={[...modal, { name: 'Laba Berjalan', amount: laba }]} />
        <div className="vb-row" style={{ gridTemplateColumns: '1fr 150px', borderTop: '1px solid var(--vb-border)', fontWeight: 600 }}>
          <div>Total Kewajiban + Modal</div><div className="vb-mono vb-accent" style={{ textAlign: 'right' }}>{rp(totalKewajiban + totalEkuitas)}</div>
        </div>
      </div>
      {!balanced && <div className="vb-danger">Neraca tidak seimbang — cek data.</div>}
    </div>
  )
}
