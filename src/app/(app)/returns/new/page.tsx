import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ReturnForm from './ReturnForm'

export default async function NewReturnPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase.from('orders').select('id, code').order('order_date', { ascending: false })
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div style={{ maxWidth: 780 }}>
      <Link href="/returns" className="vb-back">← Retur</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Retur Baru</h1>
        <div className="vb-sub">Stok bertambah otomatis saat retur disimpan</div>
      </div>
      <ReturnForm orders={orders ?? []} skus={skus ?? []} />
    </div>
  )
}
