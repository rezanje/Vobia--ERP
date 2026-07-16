'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logout } from '@/app/auth/actions'

const GROUPS: { title?: string; items: { label: string; href: string }[] }[] = [
  { items: [{ label: 'Dashboard', href: '/' }] },
  { title: 'Perencanaan', items: [{ label: 'Forecast', href: '/forecasts' }, { label: 'Proyeksi', href: '/projections' }, { label: 'Produk Baru', href: '/new-products' }] },
  { title: 'PPIC', items: [{ label: 'PCB', href: '/pcb' }, { label: 'PPO', href: '/ppo' }] },
  { title: 'Produk', items: [{ label: 'Styles', href: '/styles' }, { label: 'Stok', href: '/stock' }, { label: 'Bahan', href: '/materials' }, { label: 'HPP', href: '/costing' }] },
  { title: 'Produksi', items: [{ label: 'Produksi', href: '/production' }, { label: 'Vendor', href: '/vendors' }] },
  { title: 'Penjualan', items: [{ label: 'Order', href: '/orders' }, { label: 'Channel', href: '/channels' }, { label: 'Retur', href: '/returns' }] },
  { title: 'Pembelian', items: [{ label: 'Pembelian', href: '/purchasing' }, { label: 'Stok Bahan', href: '/material-stock' }] },
  { title: 'Keuangan', items: [{ label: 'Bagan Akun', href: '/accounts' }, { label: 'Jurnal', href: '/journals' }, { label: 'Neraca Saldo', href: '/reports/trial-balance' }, { label: 'Laba-Rugi', href: '/reports/income' }, { label: 'Neraca', href: '/reports/balance-sheet' }] },
  { title: 'HR', items: [{ label: 'Karyawan', href: '/employees' }, { label: 'Komponen Gaji', href: '/pay-components' }, { label: 'Proses Gaji', href: '/payroll' }] },
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations' }] },
]

const STORE_KEY = 'vb-nav-collapsed'

export default function SideNav() {
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
          // the group holding the current page always shows, even if the user collapsed it
          const hasActive = g.items.some((it) => active(it.href))
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
              {open && g.items.map((it) => (
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
