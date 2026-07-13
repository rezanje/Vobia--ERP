import { createClient } from '@/lib/supabase/server'
import AccountForm from './AccountForm'

const TYPE_LABEL: Record<string, string> = {
  aset: 'Aset', kewajiban: 'Kewajiban', modal: 'Modal', pendapatan: 'Pendapatan', beban: 'Beban',
}

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data: accounts } = await supabase.from('accounts').select('id, code, name, type, normal_balance, active').order('code')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Bagan Akun</h1>
        <div className="vb-sub">{accounts?.length ?? 0} akun</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, alignItems: 'start', maxWidth: 1000 }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '90px 1fr 110px 90px' }}>
            <div>Kode</div><div>Nama</div><div>Tipe</div><div>Saldo</div>
          </div>
          {!accounts?.length ? (
            <div className="vb-empty">Belum ada akun.</div>
          ) : accounts.map((a) => (
            <div key={a.id} className="vb-row" style={{ gridTemplateColumns: '90px 1fr 110px 90px' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{a.code}</div>
              <div style={{ fontWeight: 500 }}>{a.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{TYPE_LABEL[a.type] ?? a.type}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{a.normal_balance === 'debit' ? 'Debit' : 'Kredit'}</div>
            </div>
          ))}
        </div>
        <AccountForm />
      </div>
    </div>
  )
}
