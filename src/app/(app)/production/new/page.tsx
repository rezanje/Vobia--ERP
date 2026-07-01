import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')
  const { data: vendors } = await supabase.from('vendors').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New production order</h1>
      <OrderForm styles={styles ?? []} vendors={vendors ?? []} skus={skus ?? []} />
    </div>
  )
}
