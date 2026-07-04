import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function StylesPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase
    .from('style_summary')
    .select('id, code, name, collection, colorway_count, sku_count')
    .order('created_at', { ascending: false })

  const totalSku = (styles ?? []).reduce((s, x) => s + x.sku_count, 0)

  return (
    <div>
      <div className="vb-pagehead">
        <div>
          <h1 className="vb-h1">Styles</h1>
          <div className="vb-sub">{styles?.length ?? 0} style · {totalSku} SKU</div>
        </div>
        <Link href="/styles/new" className="vb-btn">+ Style Baru</Link>
      </div>

      {!styles?.length ? (
        <div className="vb-empty">Belum ada style. Buat style pertama Anda.</div>
      ) : (
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '110px 1.7fr 1.3fr 90px 70px' }}>
            <div>Kode</div><div>Nama</div><div>Koleksi</div><div style={{ textAlign: 'right' }}>Colorway</div><div style={{ textAlign: 'right' }}>SKU</div>
          </div>
          {styles.map((s) => (
            <Link key={s.id} href={`/styles/${s.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '110px 1.7fr 1.3fr 90px 70px', textDecoration: 'none', color: 'inherit' }}>
              <div className="vb-mono vb-accent" style={{ fontWeight: 500 }}>{s.code}</div>
              <div style={{ fontWeight: 500 }}>{s.name}</div>
              <div className="vb-muted">{s.collection ?? '—'}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{s.colorway_count}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{s.sku_count}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
