import SideNav from '@/components/SideNav'
import { getRole } from '@/lib/auth/role'

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  return (
    <div className="vb-app">
      <SideNav role={role} />
      <main className="vb-main"><div className="vb-container">{children}</div></main>
    </div>
  )
}
