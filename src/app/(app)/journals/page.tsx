import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import JournalForm from './JournalForm'
import OpeningBalanceButton from './OpeningBalanceButton'

export default async function JournalsPage() {
  const supabase = await createClient()
  const { data: accounts } = await supabase.from('accounts').select('code, name').eq('active', true).order('code')
  const { data: journals } = await supabase
    .from('journals').select('id, journal_date, memo, source_type').order('journal_date', { ascending: false }).limit(100)
  const ids = (journals ?? []).map((j) => j.id)
  const { data: lines } = await supabase.from('journal_lines').select('journal_id, debit')
    .in('journal_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const totalOf = new Map<string, number>()
  for (const l of lines ?? []) totalOf.set(l.journal_id, (totalOf.get(l.journal_id) ?? 0) + Number(l.debit))

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="vb-h1">Jurnal</h1>
          <div className="vb-sub">{journals?.length ?? 0} jurnal terakhir</div>
        </div>
        <OpeningBalanceButton />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '100px 1fr 130px' }}>
            <div>Tanggal</div><div>Keterangan</div><div style={{ textAlign: 'right' }}>Nilai</div>
          </div>
          {!journals?.length ? (
            <div className="vb-empty">Belum ada jurnal. Buat jurnal manual atau jalankan transaksi.</div>
          ) : journals.map((j) => (
            <div key={j.id} className="vb-row" style={{ gridTemplateColumns: '100px 1fr 130px' }}>
              <div className="vb-mono" style={{ fontSize: 12 }}>{j.journal_date}</div>
              <div style={{ fontSize: 12.5 }}>{j.memo ?? '—'}{j.source_type ? <span className="vb-muted"> · {j.source_type}</span> : null}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{rp(totalOf.get(j.id) ?? 0)}</div>
            </div>
          ))}
        </div>
        <JournalForm accounts={accounts ?? []} />
      </div>
    </div>
  )
}
