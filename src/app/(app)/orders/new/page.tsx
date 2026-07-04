import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/orders" className="vb-back">← Order</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Order Baru</h1>
        <div className="vb-sub">Stok berkurang otomatis saat order disimpan</div>
      </div>
      <OrderForm channels={channels ?? []} skus={skus ?? []} />
    </div>
  )
}
