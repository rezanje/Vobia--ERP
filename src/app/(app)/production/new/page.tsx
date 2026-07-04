import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')
  const { data: vendors } = await supabase.from('vendors').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div style={{ maxWidth: 780 }}>
      <Link href="/production" className="vb-back">← Produksi</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Order Produksi Baru</h1>
        <div className="vb-sub">Order dimulai di stage Trial</div>
      </div>
      <OrderForm styles={styles ?? []} vendors={vendors ?? []} skus={skus ?? []} />
    </div>
  )
}
