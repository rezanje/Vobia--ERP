import { createClient } from '@/lib/supabase/server'
import ReturnForm from './ReturnForm'

export default async function NewReturnPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase.from('orders').select('id, code').order('order_date', { ascending: false })
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New return</h1>
      <ReturnForm orders={orders ?? []} skus={skus ?? []} />
    </div>
  )
}
