import { createClient } from '@/lib/supabase/server'
import { getRole, canWritePpic } from '@/lib/auth/role'
import NewProductForm from './NewProductForm'
import NewProductRow from './NewProductRow'

export default async function NewProductsPage() {
  const supabase = await createClient()
  const canWrite = canWritePpic(await getRole())
  const { data: newProducts } = await supabase
    .from('new_products')
    .select('id, name, style_id, rnd_status, mkt_status, agreed_qty, notes, created_at')
    .order('created_at', { ascending: false })
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Produk Baru</h1>
        <div className="vb-sub">{newProducts?.length ?? 0} produk baru (seasonal)</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          {!newProducts?.length ? (
            <div className="vb-empty">Belum ada produk baru.</div>
          ) : newProducts.map((p) => <NewProductRow key={p.id} p={p} canWrite={canWrite} />)}
        </div>
        {canWrite ? <NewProductForm styles={styles ?? []} /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Produk Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya tim Ops/Owner yang bisa menambah/mengubah produk baru. Anda bisa melihat status di sebelah kiri.</div>
          </div>
        )}
      </div>
    </div>
  )
}
