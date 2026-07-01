import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="vb-app">
      <nav className="vb-side">
        <div style={{ color: 'var(--vb-accent)', fontWeight: 500, padding: '4px 10px 12px' }}>Vobia ERP</div>
        <Link href="/">Dashboard</Link>
        <Link href="/styles">Styles</Link>
      </nav>
      <main className="vb-main">{children}</main>
    </div>
  )
}
