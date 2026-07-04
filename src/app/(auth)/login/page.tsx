import Link from 'next/link'
import { login } from '@/app/auth/actions'

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--vb-bg)', color: 'var(--vb-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form action={login} className="vb-card" style={{ width: 360, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 className="vb-h1">Masuk</h1>
        <input name="email" type="email" placeholder="Email" required className="vb-input" />
        <input name="password" type="password" placeholder="Password" required className="vb-input" />
        <button type="submit" className="vb-btn">Masuk</button>
        <Link href="/signup" className="vb-sub" style={{ textAlign: 'center' }}>Belum punya akun? Daftar</Link>
      </form>
    </main>
  )
}
