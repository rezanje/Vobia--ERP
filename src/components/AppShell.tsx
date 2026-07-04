import SideNav from '@/components/SideNav'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vb-app">
      <SideNav />
      <main className="vb-main"><div className="vb-container">{children}</div></main>
    </div>
  )
}
