import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profiles } = await supabase.from('profiles').select('id, tenant_id, role')

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Vobia ERP</h1>
      <p className="mt-2 text-sm">Signed in as {user.email}</p>
      <pre className="mt-4 bg-neutral-100 p-3 text-xs">{JSON.stringify(profiles, null, 2)}</pre>
      <form action={logout}><button className="mt-4 underline">Log out</button></form>
    </main>
  )
}
