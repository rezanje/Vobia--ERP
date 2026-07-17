# RBAC Increment: Penjualan (Order, Channel, Retur)

**Date:** 2026-07-17
**Goal:** Restrict sales writes — order create, channel create, return create — to `owner`/`sales`; `ops`/`finance` view; hidden from other roles. Reads stay tenant-wide.
**Depth:** Full — DB write guards + RLS + UI, same standard as prior increments. Third legacy-module increment of the B5 RBAC rollout.

## Konteks

Follows [[vobia-rbac-sales-ops-built]] (P1–P3, Catalog, Produksi). Full matrix: `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md`. Demo account `sales` already seeded — no new accounts.

Penjualan write surfaces (codebase scan):
- `create_order(uuid,date,text,text,jsonb)` — RPC, `security invoker`, writes `orders`+`order_lines`, posts `sale_out` stock via `record_movement`.
- `create_return(uuid,date,text,text,jsonb)` — RPC, `security invoker`, writes `returns`+`return_lines`, posts `return_in` stock via `record_movement`.
- `channels.insert` — direct (`src/lib/orders/actions.ts`), Channel.

## Keputusan desain — WRITE-only gating, READ stays tenant-wide

Same lesson as prior increments: `channels` is referenced by orders; orders/returns are read by finance (reports) and other flows. RLS-blocking their SELECT would break those. Gate WRITE only; leave `tenant_isolation` SELECT untouched; no page redirects. "No access" = sidebar-hidden + no write controls. Reads via URL render read-only. The `record_movement` stock posts inside the two fns are reached only through the gated fns (not separately role-gated here — Stok increment concern).

## Role sets

| Surface | Write roles |
|---|---|
| `create_order` (fn guard) | owner, sales |
| `create_return` (fn guard) | owner, sales |
| `orders`, `order_lines` (RLS write) | owner, sales |
| `returns`, `return_lines` (RLS write) | owner, sales |
| `channels` (RLS write) | owner, sales |

`ops`/`finance` = view (see menu + read-only pages). `production`/`inventory`/`viewer` = no Penjualan menu.

## Perubahan

| Layer | Perubahan |
|---|---|
| Schema | none |
| DB fn | guard `create_order` + `create_return` → role owner/sales (fail-closed `coalesce(v_role not in (...), true)`), first check after `v_tenant is null`. |
| DB RLS | RESTRICTIVE per-command write-policies (insert/update/delete, unique names) on `orders`, `order_lines`, `returns`, `return_lines`, `channels` → owner/sales. Reads untouched. |
| Demo accounts | none new. |
| role.ts | `canWriteSales(role)=owner\|sales`. |
| Sidebar | Penjualan group items (Order, Channel, Retur) → `roles: ['owner','sales','ops','finance']` (hidden for production/inventory/viewer). |
| UI | `orders/page.tsx` (`+ Order Baru` link → canWriteSales); `channels/page.tsx` (`ChannelForm` → canWriteSales else note); `returns/page.tsx` (`+ Retur Baru` link → canWriteSales). Order/return detail pages are read-only already — no change. |
| Test | pgTAP `penjualan_access.test.sql`: sales creates order + channel + return; ops/finance blocked from all three writes but read intact; + additive `user_role` claim on any broken fixture. |

## Keputusan desain (detail)

- **orders/order_lines/returns/return_lines RLS despite fn-only writes:** the two RPCs are the only app write path, but direct PostgREST writes would bypass them — the Catalog/Produksi lesson (RLS the fn-written tables too) applies. Same owner/sales role set as the fn guards, so a legit caller passes both.
- **`/orders/new` + `/returns/new` create-form pages left un-redirected/ungated:** consistent with the Catalog increment (which gated the list link, not `/styles/new`). A view role URL-navigating there sees the form but the DB fn guard rejects the submit. Sidebar hides Penjualan from non-view roles anyway.
- **Fail-closed:** missing `user_role` claim denies. No `coalesce(...,'owner')` fallback.

## Testing

pgTAP as above + browser: `sales.demo` creates an order/channel/return; a view role (ops or finance) sees the Penjualan menu but `/orders` and `/returns` have no create button and `/channels` shows the read-only note; `production`/`inventory` have no Penjualan menu. Full regression suite stays green.
