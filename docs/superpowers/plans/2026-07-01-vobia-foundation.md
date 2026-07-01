# Vobia ERP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Next.js + Supabase repo with multi-tenant Row-Level Security and auth working end-to-end, proven by a cross-tenant isolation test.

**Architecture:** Single repo. Next.js App Router (TS, Tailwind) talks to Supabase (Postgres + Auth) via `@supabase/ssr`. Tenant isolation lives in the database via RLS keyed on a `tenant_id` JWT claim; a custom access token hook injects that claim, and a signup trigger auto-creates a tenant + owner profile. No business tables yet — this is the ground layer plus the reusable RLS template.

**Tech Stack:** Next.js (latest), TypeScript, Tailwind, `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI (local stack), pgTAP (`supabase test db`), Playwright.

**Related specs:** `docs/superpowers/specs/2026-07-01-vobia-foundation-design.md`, `docs/superpowers/specs/vobia_erp_phase1_prd.md`

---

## File Structure

```
/(repo root)
  _legacy-prototype/        # salvaged Vite/React mock — design reference only, not built
  docs/superpowers/…        # specs + this plan (unchanged)
  supabase/
    config.toml             # local stack + auth hook registration
    migrations/
      0001_foundation.sql   # tenants, profiles, RLS policies
      0002_new_user.sql     # handle_new_user() trigger
      0003_auth_hook.sql    # custom_access_token_hook() + grants
    tests/
      rls.test.sql          # pgTAP: tenant isolation
      new_user.test.sql     # pgTAP: signup trigger
      auth_hook.test.sql    # pgTAP: claim injection
    seed.sql                # two tenants for manual/dev use
  src/
    lib/supabase/
      client.ts             # browser client
      server.ts             # server component / action client (cookies)
    middleware.ts           # session refresh
    types/database.ts       # generated (do not edit)
    app/
      (auth)/login/page.tsx
      (auth)/signup/page.tsx
      auth/actions.ts       # signup + login + logout Server Actions
      page.tsx              # empty authed dashboard placeholder
  e2e/auth.spec.ts          # Playwright happy-path
  playwright.config.ts
```

---

## Task 1: Init repo, salvage prototype, scaffold Next.js

**Files:**
- Create: `_legacy-prototype/` (moved), Next.js scaffold in repo root
- Delete: old `node_modules/`, old `dist/`

- [ ] **Step 1: Init git**

Run:
```bash
git init && printf "node_modules/\n.next/\ndist/\n.env*.local\n.DS_Store\n" > .gitignore
```

- [ ] **Step 2: Salvage the Vite prototype out of the way**

Run:
```bash
mkdir -p _legacy-prototype
git mv 2>/dev/null src index.html package.json package-lock.json _legacy-prototype/ \
  || mv src index.html package.json package-lock.json _legacy-prototype/
rm -rf node_modules dist output .playwright-cli
```
Expected: repo root now has `docs/`, `_legacy-prototype/`, `.gitignore` only.

- [ ] **Step 3: Scaffold Next.js in place**

Run (create-next-app tolerates the extra `docs/` and `_legacy-prototype/` dirs; it only refuses on conflicting files like `package.json`, which we moved):
```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```
Expected: `src/app/`, `next.config.*`, `package.json` created. Dev server boots with `npm run dev`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app, salvage Vite prototype to _legacy-prototype"
```

---

## Task 2: Init Supabase local stack

**Files:**
- Create: `supabase/config.toml` (via CLI)

- [ ] **Step 1: Install Supabase CLI as dev dep + init**

Run:
```bash
npm i -D supabase
npx supabase init
```
Expected: `supabase/config.toml` created.

- [ ] **Step 2: Start local stack**

Run: `npx supabase start`
Expected: prints API URL (`http://127.0.0.1:54321`), anon key, service_role key, DB URL. Docker must be running.

- [ ] **Step 3: Wire env**

Create `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from step 2>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from step 2>
```

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: init Supabase local stack"
```

---

## Task 3: Foundation schema + RLS (TDD via pgTAP)

**Files:**
- Test: `supabase/tests/rls.test.sql`
- Create: `supabase/migrations/0001_foundation.sql`

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/rls.test.sql`:
```sql
begin;
select plan(3);

select has_table('public','tenants','tenants table exists');
select has_table('public','profiles','profiles table exists');

-- seed two tenants + two profiles bypassing RLS (as postgres).
-- auth.users rows first to satisfy the profiles FK. (No signup trigger yet at
-- this migration, so profiles are inserted manually.)
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@a.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@b.test');
insert into public.tenants (id, name) values
  ('11111111-1111-1111-1111-111111111111','Tenant A'),
  ('22222222-2222-2222-2222-222222222222','Tenant B');
insert into public.profiles (id, tenant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','owner');

-- act as an authenticated user of Tenant A
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tenant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}';

select is(
  (select count(*)::int from public.profiles where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Tenant A cannot read Tenant B profiles'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — `tenants`/`profiles` do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0001_foundation.sql`:
```sql
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  role text not null default 'viewer'
    check (role in ('owner','ops','production','inventory','finance','viewer')),
  full_name text,
  created_at timestamptz not null default now()
);
create index profiles_tenant_id_idx on public.profiles(tenant_id);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;

-- reusable tenant-isolation template (copy for every future ber-tenant_id table)
create policy tenant_isolation on public.profiles
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- bootstrap: read own profile via uid even before tenant_id claim exists
create policy self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy own_tenant on public.tenants
  for select to authenticated
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- explicit table grants: RLS gates rows, but the authenticated role still needs
-- the table-level privilege or queries error instead of returning 0 rows.
grant select on public.tenants to authenticated;
grant select on public.profiles to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_foundation.sql supabase/tests/rls.test.sql
git commit -m "feat: tenants + profiles schema with tenant-isolation RLS"
```

---

## Task 4: Signup trigger — auto-create tenant + owner profile (TDD)

**Files:**
- Test: `supabase/tests/new_user.test.sql`
- Create: `supabase/migrations/0002_new_user.sql`

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/new_user.test.sql`:
```sql
begin;
select plan(2);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','c@c.test',
        '{"tenant_name":"Acme","full_name":"Cee"}');

select is(
  (select count(*)::int from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1, 'profile auto-created on signup');

select is(
  (select t.name from public.tenants t
     join public.profiles p on p.tenant_id = t.id
     where p.id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Acme', 'tenant created from user metadata');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — no profile created (trigger absent).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0002_new_user.sql`:
```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name)
  values (coalesce(new.raw_user_meta_data->>'tenant_name', 'Tenant'))
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, new_tenant_id, 'owner', new.raw_user_meta_data->>'full_name');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_new_user.sql supabase/tests/new_user.test.sql
git commit -m "feat: auto-create tenant + owner profile on signup"
```

---

## Task 5: Custom access token hook — inject tenant_id + role (TDD)

**Files:**
- Test: `supabase/tests/auth_hook.test.sql`
- Create: `supabase/migrations/0003_auth_hook.sql`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/auth_hook.test.sql`:
```sql
begin;
select plan(2);

insert into public.tenants (id, name)
  values ('33333333-3333-3333-3333-333333333333','Hooked');
insert into auth.users (id, instance_id, aud, role, email)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','d@d.test');
-- overwrite the trigger-created profile to a known tenant
update public.profiles
  set tenant_id='33333333-3333-3333-3333-333333333333', role='ops'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';

select is(
  public.custom_access_token_hook(
    '{"user_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","claims":{}}'::jsonb
  ) -> 'claims' ->> 'tenant_id',
  '33333333-3333-3333-3333-333333333333',
  'hook injects tenant_id claim');

select is(
  public.custom_access_token_hook(
    '{"user_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","claims":{}}'::jsonb
  ) -> 'claims' ->> 'role',
  'ops',
  'hook injects role claim');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — `custom_access_token_hook` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0003_auth_hook.sql`:
```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  p record;
begin
  select tenant_id, role into p
  from public.profiles
  where id = (event->>'user_id')::uuid;

  if p.tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(p.tenant_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(p.role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- the hook runs as supabase_auth_admin: it must execute the fn and read profiles
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant all on table public.profiles to supabase_auth_admin;
create policy "auth admin reads profiles" on public.profiles
  as permissive for select to supabase_auth_admin using (true);
```

- [ ] **Step 4: Register the hook in config.toml**

Add to `supabase/config.toml`:
```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

- [ ] **Step 5: Restart stack + run test**

Run: `npx supabase stop && npx supabase start && npx supabase test db`
Expected: PASS — all pgTAP tests green (3 files).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0003_auth_hook.sql supabase/tests/auth_hook.test.sql supabase/config.toml
git commit -m "feat: custom access token hook injects tenant_id + role into JWT"
```

---

## Task 6: Generate TypeScript types

**Files:**
- Modify: `package.json`
- Create: `src/types/database.ts`

- [ ] **Step 1: Add codegen script**

Add to `package.json` `scripts`:
```json
"gen:types": "supabase gen types typescript --local > src/types/database.ts"
```

- [ ] **Step 2: Run it**

Run: `npm run gen:types`
Expected: `src/types/database.ts` written, contains `tenants` and `profiles` row types, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json src/types/database.ts
git commit -m "chore: generated database types + gen:types script"
```

---

## Task 7: Supabase SSR clients + middleware

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts`

- [ ] **Step 1: Install @supabase/ssr**

Run: `npm i @supabase/ssr @supabase/supabase-js`

- [ ] **Step 2: Browser client**

`src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 3: Server client**

`src/lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // called from a Server Component — safe to ignore, middleware refreshes
          }
        },
      },
    },
  )
}
```

- [ ] **Step 4: Middleware (session refresh)**

`src/middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase src/middleware.ts package.json package-lock.json
git commit -m "feat: supabase SSR clients + session middleware"
```

---

## Task 8: Auth pages + Server Actions

**Files:**
- Create: `src/app/auth/actions.ts`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Server Actions**

`src/app/auth/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
    options: {
      data: {
        tenant_name: String(formData.get('tenant_name')),
        full_name: String(formData.get('full_name')),
      },
    },
  })
  if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`)
  redirect('/')
}

export async function login(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  })
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
```

- [ ] **Step 2: Signup page**

`src/app/(auth)/signup/page.tsx`:
```tsx
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
```

- [ ] **Step 3: Login page**

`src/app/(auth)/login/page.tsx`:
```tsx
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
```

- [ ] **Step 4: Dashboard placeholder — proves session + claim**

`src/app/page.tsx`:
```tsx
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
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/signup`, create a workspace.
Expected: redirected to `/`, see your email + exactly one profile row whose `tenant_id` matches your workspace.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat: signup/login/logout auth flow with tenant-scoped dashboard"
```

---

## Task 9: Playwright happy-path E2E

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Playwright**

Run: `npm i -D @playwright/test && npx playwright install chromium`

- [ ] **Step 2: Config**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] **Step 3: Write the E2E test**

`e2e/auth.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('signup creates a workspace and shows own profile', async ({ page }) => {
  const email = `user_${Date.now()}@test.local`
  await page.goto('/signup')
  await page.fill('input[name="tenant_name"]', 'Playwright Co')
  await page.fill('input[name="full_name"]', 'PW User')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button[type="submit"]')

  await expect(page.getByText(email)).toBeVisible()
  // exactly one profile row visible in the JSON dump → tenant isolation holds
  await expect(page.getByText('"role": "owner"')).toBeVisible()
})
```

- [ ] **Step 4: Add script + run**

Add to `package.json` scripts: `"e2e": "playwright test"`.
Run: `npm run e2e` (local Supabase stack must be up).
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json
git commit -m "test: Playwright signup happy-path E2E"
```

---

## Acceptance (whole sub-project)

- [ ] `npx supabase test db` → all pgTAP green (isolation, signup trigger, hook claims).
- [ ] `npm run e2e` → signup flow passes.
- [ ] Manual: two separate signups produce two tenants; each dashboard shows only its own profile row.
- [ ] `npm run gen:types` regenerates `database.ts` clean.
- [ ] `npm run build` succeeds.
