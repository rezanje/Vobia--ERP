import { login } from '@/app/auth/actions'

export default function LoginPage() {
  return (
    <form action={login} className="mx-auto mt-24 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-semibold">Log in</h1>
      <input name="email" type="email" placeholder="Email" required className="border p-2" />
      <input name="password" type="password" placeholder="Password" required className="border p-2" />
      <button type="submit" className="bg-black p-2 text-white">Log in</button>
    </form>
  )
}
