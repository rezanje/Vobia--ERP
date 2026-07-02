import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New order</h1>
      <OrderForm channels={channels ?? []} skus={skus ?? []} />
    </div>
  )
}
