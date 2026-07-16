import { createClient } from '@/lib/supabase/server'
import { getRole } from '@/lib/auth/role'
import ForecastForm from './ForecastForm'

const KIND_META: Record<string, { label: string; c: string; bg: string }> = {
  sales: { label: 'Sales', c: '#8fb8e0', bg: 'rgba(143,184,224,.13)' },
  ops: { label: 'Operasional', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
}

export default async function ForecastsPage() {
  const supabase = await createClient()
  const role = await getRole()
  const { data: forecasts } = await supabase
    .from('forecasts')
    .select('id, kind, period, notes, created_at')
    .order('period', { ascending: false })
    .order('kind')
  const { data: lines } = await supabase.from('forecast_lines').select('forecast_id, qty')
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')

  const countByForecast = new Map<string, number>()
  const totalByForecast = new Map<string, number>()
  for (const l of lines ?? []) {
    countByForecast.set(l.forecast_id, (countByForecast.get(l.forecast_id) ?? 0) + 1)
    totalByForecast.set(l.forecast_id, (totalByForecast.get(l.forecast_id) ?? 0) + Number(l.qty))
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Forecast</h1>
        <div className="vb-sub">{forecasts?.length ?? 0} forecast</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 110px 90px 90px' }}>
            <div>Periode</div><div>Jenis</div><div>Baris</div><div>Total Qty</div>
          </div>
          {!forecasts?.length ? (
            <div className="vb-empty">Belum ada forecast.</div>
          ) : forecasts.map((f) => {
            const meta = KIND_META[f.kind] ?? { label: f.kind, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <div key={f.id} className="vb-row" style={{ gridTemplateColumns: '1fr 110px 90px 90px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{f.period}</div>
                <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                <div style={{ fontSize: 12.5 }}>{countByForecast.get(f.id) ?? 0}</div>
                <div style={{ fontSize: 12.5 }}>{totalByForecast.get(f.id) ?? 0}</div>
              </div>
            )
          })}
        </div>
        <ForecastForm styles={styles ?? []} role={role} />
      </div>
    </div>
  )
}
