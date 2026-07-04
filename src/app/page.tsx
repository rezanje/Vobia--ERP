import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { rp } from '@/lib/ui'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--vb-bg)', color: 'var(--vb-text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-grotesk)', fontSize: 28, fontWeight: 600, color: 'var(--vb-accent)' }}>Vobia ERP</h1>
        <p className="vb-muted">Operations control for fashion commerce.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/login" className="vb-btn">Log in</Link>
          <Link href="/signup" className="vb-btn-ghost">Sign up</Link>
        </div>
      </main>
    )
  }

  const [{ count: styleCount }, { count: skuCount }, { count: openProdCount }, { count: orderCount }, { data: balances }] = await Promise.all([
    supabase.from('styles').select('id', { count: 'exact', head: true }),
    supabase.from('skus').select('id', { count: 'exact', head: true }),
    supabase.from('production_orders').select('id', { count: 'exact', head: true }).in('stage', ['trial', 'mass_production', 'qc']),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('stock_balances').select('sku_id, balance'),
  ])

  const stockUnits = (balances ?? []).reduce((s, b) => s + (b.balance ?? 0), 0)
  const oversoldBalances = (balances ?? []).filter((b) => (b.balance ?? 0) < 0)
  const oversoldSkuIds = oversoldBalances.map((b) => b.sku_id).filter((id): id is string => !!id)
  const { data: oversoldSkus } = oversoldSkuIds.length
    ? await supabase.from('skus').select('id, sku_code').in('id', oversoldSkuIds)
    : { data: [] as { id: string; sku_code: string }[] }
  const skuCodeOf = new Map((oversoldSkus ?? []).map((s) => [s.id, s.sku_code]))
  const oversold = oversoldBalances.map((b) => ({ code: skuCodeOf.get(b.sku_id ?? '') ?? b.sku_id, bal: b.balance ?? 0 }))

  const { data: recentOrders } = await supabase
    .from('orders').select('id, code, order_date, channel_id')
    .order('order_date', { ascending: false }).limit(5)
  const channelIds = [...new Set((recentOrders ?? []).map((o) => o.channel_id))]
  const { data: channels } = channelIds.length
    ? await supabase.from('channels').select('id, name').in('id', channelIds)
    : { data: [] as { id: string; name: string }[] }
  const channelNameOf = new Map((channels ?? []).map((c) => [c.id, c.name]))
  const orderIds = (recentOrders ?? []).map((o) => o.id)
  const { data: recentLines } = orderIds.length
    ? await supabase.from('order_lines').select('order_id, qty, unit_price').in('order_id', orderIds)
    : { data: [] as { order_id: string; qty: number; unit_price: number }[] }
  const totalOf = new Map<string, number>()
  for (const l of recentLines ?? []) totalOf.set(l.order_id, (totalOf.get(l.order_id) ?? 0) + l.qty * Number(l.unit_price))

  const metrics = [
    { label: 'Styles', value: styleCount ?? 0, sub: 'Total style aktif', href: '/styles' },
    { label: 'SKU', value: skuCount ?? 0, sub: 'Total varian', href: '/styles' },
    { label: 'Unit Stok', value: rp(stockUnits), sub: 'Total saldo semua SKU', href: '/stock' },
    { label: 'Produksi Berjalan', value: openProdCount ?? 0, sub: 'Trial · Mass Prod · QC', href: '/production' },
    { label: 'Order', value: orderCount ?? 0, sub: 'Total order tercatat', href: '/orders' },
  ]

  return (
    <AppShell>
      <div>
        <h1 className="vb-h1">Dashboard</h1>
        <div className="vb-sub">Ringkasan operasional Vobia hari ini</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, margin: '22px 0 14px' }}>
        {metrics.map((m) => (
          <Link key={m.label} href={m.href} className="vb-metric">
            <div className="vb-metric-label">{m.label}</div>
            <div className="vb-metric-value">{m.value}</div>
            <div className="vb-metric-sub">{m.sub}</div>
          </Link>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--vb-danger)' }} />
            <div className="vb-cardtitle">Oversold Alert</div>
          </div>
          {oversold.length ? (
            <>
              <div className="vb-thead" style={{ gridTemplateColumns: '1fr 90px' }}>
                <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Saldo</div>
              </div>
              {oversold.map((o) => (
                <div key={o.code} className="vb-row" style={{ gridTemplateColumns: '1fr 90px' }}>
                  <div className="vb-mono" style={{ fontWeight: 500 }}>{o.code}</div>
                  <div className="vb-mono vb-danger" style={{ fontWeight: 600, textAlign: 'right' }}>{o.bal}</div>
                </div>
              ))}
            </>
          ) : (
            <div className="vb-empty">Tidak ada SKU oversold. Semua saldo aman.</div>
          )}
        </div>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="vb-cardtitle">Order Terbaru</div>
            <Link href="/orders" style={{ fontSize: 12, color: 'var(--vb-accent)', textDecoration: 'none' }}>Lihat semua →</Link>
          </div>
          {(recentOrders ?? []).length ? (
            <>
              <div className="vb-thead" style={{ gridTemplateColumns: '120px 1fr 100px 120px' }}>
                <div>Kode</div><div>Channel</div><div>Tanggal</div><div style={{ textAlign: 'right' }}>Total</div>
              </div>
              {(recentOrders ?? []).map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '120px 1fr 100px 120px', textDecoration: 'none', color: 'inherit' }}>
                  <div className="vb-mono vb-accent" style={{ fontWeight: 500 }}>{o.code}</div>
                  <div>{channelNameOf.get(o.channel_id) ?? '—'}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{o.order_date}</div>
                  <div className="vb-mono" style={{ fontWeight: 500, textAlign: 'right' }}>{rp(totalOf.get(o.id) ?? 0)}</div>
                </Link>
              ))}
            </>
          ) : (
            <div className="vb-empty">Belum ada order.</div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
