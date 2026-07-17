'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logout } from '@/app/auth/actions'

const GROUPS: { title?: string; items: { label: string; href: string; roles?: string[] }[] }[] = [
  { items: [{ label: 'Dashboard', href: '/' }] },
  { title: 'Perencanaan', items: [
      { label: 'Forecast', href: '/forecasts', roles: ['owner', 'sales', 'ops'] },
      { label: 'Proyeksi', href: '/projections', roles: ['owner', 'sales', 'ops'] },
      { label: 'Produk Baru', href: '/new-products', roles: ['owner', 'sales', 'ops'] },
    ] },
  { title: 'PPIC', items: [
      { label: 'PCB', href: '/pcb', roles: ['owner', 'ops'] },
      { label: 'PPO', href: '/ppo', roles: ['owner', 'ops'] },
    ] },
  { title: 'Produk', items: [
      { label: 'Styles', href: '/styles', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
      { label: 'Stok', href: '/stock' },
      { label: 'Bahan', href: '/materials', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
      { label: 'HPP', href: '/costing', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
    ] },
  { title: 'Produksi', items: [
      { label: 'Produksi', href: '/production', roles: ['owner', 'production', 'ops'] },
      { label: 'Vendor', href: '/vendors', roles: ['owner', 'production', 'ops'] },
    ] },
  { title: 'Penjualan', items: [
      { label: 'Order', href: '/orders', roles: ['owner', 'sales', 'ops', 'finance'] },
      { label: 'Channel', href: '/channels', roles: ['owner', 'sales', 'ops', 'finance'] },
      { label: 'Retur', href: '/returns', roles: ['owner', 'sales', 'ops', 'finance'] },
    ] },
  { title: 'Pembelian', items: [{ label: 'Pembelian', href: '/purchasing' }, { label: 'Stok Bahan', href: '/material-stock' }] },
  { title: 'Keuangan', items: [{ label: 'Bagan Akun', href: '/accounts' }, { label: 'Jurnal', href: '/journals' }, { label: 'Neraca Saldo', href: '/reports/trial-balance' }, { label: 'Laba-Rugi', href: '/reports/income' }, { label: 'Neraca', href: '/reports/balance-sheet' }] },
  { title: 'HR', items: [{ label: 'Karyawan', href: '/employees' }, { label: 'Komponen Gaji', href: '/pay-components' }, { label: 'Proses Gaji', href: '/payroll' }] },
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations', roles: ['owner', 'ops', 'inventory'] }] },
]

const STORE_KEY = 'vb-nav-collapsed'

export default function SideNav({ role }: { role: string | null }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  // set of collapsed group titles; empty = all open. Loaded from localStorage after mount
  // (not during render) to avoid an SSR/client hydration mismatch.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw)))
    } catch { /* ignore corrupt/absent storage */ }
  }, [])

  const toggle = (title: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    next.has(title) ? next.delete(title) : next.add(title)
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  return (
    <aside className="vb-side">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vobia-logo-white.png" alt="Vobia" className="vb-logo" />
      <nav className="vb-nav">
        {GROUPS.map((g, i) => {
          const items = g.items.filter((it) => !it.roles || it.roles.includes(role ?? ''))
          if (!items.length) return null
          // the group holding the current page always shows, even if the user collapsed it
          const hasActive = items.some((it) => active(it.href))
          const open = !g.title || hasActive || !collapsed.has(g.title)
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {g.title && (
                <button
                  type="button"
                  className="vb-navgroup-title"
                  onClick={() => toggle(g.title!)}
                  aria-expanded={open}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                >
                  {g.title}
                  <span aria-hidden style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none', fontSize: 9, opacity: 0.6 }}>▶</span>
                </button>
              )}
              {open && items.map((it) => (
                <Link key={it.href} href={it.href} className={`vb-navitem${active(it.href) ? ' on' : ''}`}>{it.label}</Link>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="vb-sidefoot">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--vb-accent)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Vobia Studio</div>
          <div style={{ fontSize: 11, color: 'var(--vb-muted)' }}>Ops · Jakarta</div>
        </div>
        <form action={logout}>
          <button type="submit" style={{ background: 'none', border: 'none', color: 'var(--vb-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Keluar</button>
        </form>
      </div>
    </aside>
  )
}
