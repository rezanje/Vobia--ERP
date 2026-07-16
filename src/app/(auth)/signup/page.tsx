import Link from 'next/link'
import { signup } from '@/app/auth/actions'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main style={{ minHeight: '100vh', background: 'var(--vb-bg)', color: 'var(--vb-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form action={signup} className="vb-card" style={{ width: 380, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 className="vb-h1">Buat Workspace Vobia</h1>
        {error && <div className="vb-danger">{error}</div>}
        <input name="tenant_name" placeholder="Nama workspace" required className="vb-input" />
        <input name="full_name" placeholder="Nama Anda" className="vb-input" />
        <input name="email" type="email" placeholder="Email" required className="vb-input" />
        <input name="password" type="password" placeholder="Password" required className="vb-input" />
        <button type="submit" className="vb-btn">Daftar</button>
        <Link href="/login" className="vb-sub" style={{ textAlign: 'center' }}>Sudah punya akun? Masuk</Link>
      </form>
    </main>
  )
}
