'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/auth/actions'

const GROUPS: { title?: string; items: { label: string; href: string }[] }[] = [
  { items: [{ label: 'Dashboard', href: '/' }] },
  { title: 'Produk', items: [{ label: 'Styles', href: '/styles' }, { label: 'Stok', href: '/stock' }, { label: 'HPP', href: '/costing' }] },
  { title: 'Produksi', items: [{ label: 'Produksi', href: '/production' }, { label: 'Vendor', href: '/vendors' }] },
  { title: 'Penjualan', items: [{ label: 'Order', href: '/orders' }, { label: 'Channel', href: '/channels' }, { label: 'Retur', href: '/returns' }] },
]

export default function SideNav() {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  return (
    <aside className="vb-side">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vobia-logo-white.png" alt="Vobia" className="vb-logo" />
      <nav className="vb-nav">
        {GROUPS.map((g, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.title && <div className="vb-navgroup-title">{g.title}</div>}
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={`vb-navitem${active(it.href) ? ' on' : ''}`}>{it.label}</Link>
            ))}
          </div>
        ))}
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
