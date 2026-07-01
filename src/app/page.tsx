import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--vb-bg)', color: 'var(--vb-text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 500, color: 'var(--vb-accent)' }}>Vobia ERP</h1>
        <p style={{ color: 'var(--vb-muted)' }}>Operations control for fashion commerce.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/login" className="vb-btn" style={{ textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" className="vb-btn-ghost" style={{ textDecoration: 'none' }}>Sign up</Link>
        </div>
      </main>
    )
  }

  const { data: profiles } = await supabase.from('profiles').select('id, tenant_id, role')

  return (
    <main style={{ minHeight: '100vh', background: 'var(--vb-bg)', color: 'var(--vb-text)', padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>Vobia ERP</h1>
      <p style={{ color: 'var(--vb-muted)', marginTop: 6 }}>Signed in as {user.email}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Link href="/styles" className="vb-btn" style={{ textDecoration: 'none' }}>Styles</Link>
      </div>
      <pre style={{ marginTop: 16, background: 'var(--vb-surface)', border: '1px solid var(--vb-border)', borderRadius: 8, padding: 12, fontSize: 12 }}>{JSON.stringify(profiles, null, 2)}</pre>
      <form action={logout}><button className="vb-btn-ghost" style={{ marginTop: 16 }}>Log out</button></form>
    </main>
  )
}
