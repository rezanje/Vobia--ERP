import { signup } from '@/app/auth/actions'

export default function SignupPage() {
  return (
    <form action={signup} className="mx-auto mt-24 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-semibold">Create Vobia workspace</h1>
      <input name="tenant_name" placeholder="Workspace name" required className="border p-2" />
      <input name="full_name" placeholder="Your name" className="border p-2" />
      <input name="email" type="email" placeholder="Email" required className="border p-2" />
      <input name="password" type="password" placeholder="Password" required className="border p-2" />
      <button type="submit" className="bg-black p-2 text-white">Sign up</button>
    </form>
  )
}
