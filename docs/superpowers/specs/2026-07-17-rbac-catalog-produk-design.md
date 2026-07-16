# RBAC Increment: Katalog Produk (Styles / Bahan / HPP)

**Date:** 2026-07-17
**Goal:** Extend the role-based access model (already live for P1–P3) to the product-catalog modules — Styles, Bahan (materials), HPP (costing) — so only `owner`/`production`/`inventory` can write them, `ops`/`finance` can view, and `sales`/`viewer` don't see them.
**Depth:** Full — DB write guards + RLS + UI + demo accounts + pgTAP, same enforcement standard as the P1–P3 RBAC. First of several per-module increments extending RBAC to legacy modules (B5).

## Konteks

Follows [[vobia-rbac-sales-ops-built]] (P1–P3 role gating, merged). The full role matrix is in `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md`. This increment applies the same pattern to the catalog modules. Deliberately EXCLUDES `/stock` (the stock ledger, `record_movement`/`record_transfer`) — that's append-only and shared across many callers, handled in a later dedicated increment.

Catalog write surfaces (from a codebase scan):
- `create_style_with_skus(text,text,text,jsonb,text[],jsonb)` — RPC, `security invoker`, writes `styles`+`colorways`+`skus`. Sole write path for `styles`/`colorways`.
- `skus.update` — direct table write (`src/lib/products/actions.ts`), for SKU active-toggle.
- `materials.insert` — direct (`src/lib/materials/actions.ts`), Bahan.
- `bom_lines.insert`/`delete` — direct (`src/lib/bom/actions.ts`), the BOM (bill-of-materials) editor on the Styles detail page — part of the style/catalog definition, so gated here too.

**Scope note — HPP/`cost_entries` excluded from this increment.** The HPP page (`/costing`) is a read-only view of `sku_hpp`; it has no write control. `cost_entries` is written only by `addCostEntry` (`src/lib/costing/actions.ts`), triggered from the **production-order detail page** — i.e. its write UI lives in the Produksi module, not the catalog. So `cost_entries` DB+UI gating is deferred to the later Produksi increment where its control lives. This increment covers **Styles + Bahan** writes; the HPP sidebar item is visibility-gated only (stays a read-only view for catalog+view roles).

## Keputusan desain — READ tetap tenant-wide (WRITE-only gating)

`styles`/`colorways`/`skus`/`materials` are read cross-module: `create_forecast`/`create_pcb` read `styles`; orders read `skus`; the ending-stock join reads `colorways`/`skus`. RLS-blocking their SELECT for non-catalog roles would break those flows (e.g. a `sales` user creating a forecast reads `styles`). Therefore: **gate WRITE only; leave READ on the existing tenant-wide `tenant_isolation` policies untouched.** "Sales/viewer no access" is expressed as sidebar-hidden + no write controls, NOT an RLS read block. This is the same lesson recorded in [[vobia-rbac-sales-ops-built]] (fail-closed on WRITE, don't over-restrict READ).

## Perubahan

| Layer | Perubahan |
|---|---|
| Schema | none (roles `production`/`inventory` already valid in `profiles.role`) |
| DB fn | `create_style_with_skus` → add guard: `(auth.jwt()->>'user_role')` must be in `owner`/`production`/`inventory`, else raise Indonesian exception. Guard is first check after `v_tenant is null`. NULL-safe (`coalesce(... in (...), false)` deny). |
| DB RLS | Add RESTRICTIVE write-policies (insert/update/delete, named per-command to avoid the duplicate-name trap hit last increment) on `skus`, `materials`, `bom_lines`: write requires `(auth.jwt()->>'user_role') in ('owner','production','inventory')`. Existing `tenant_isolation` (SELECT + tenant scope) left untouched. (`cost_entries` deferred — see scope note.) |
| Demo accounts | Extend `scripts/seed-users.mjs` to also seed `prod.demo@vobia.test` (role `production`) + `inv.demo@vobia.test` (role `inventory`), same tenant/password as sales/ops. |
| role.ts | `canWriteCatalog(role) = owner\|production\|inventory`; `canViewCatalog(role) = owner\|production\|inventory\|ops\|finance`. |
| Sidebar | Produk group items Styles/Bahan/HPP get `roles: ['owner','production','inventory','ops','finance']` (hidden for sales/viewer). **Stok item stays unrestricted** (ledger, separate increment). |
| UI pages | Styles list (`+ Style Baru` link), Styles detail (SKU edit control), Bahan (`<MaterialForm>`) → write controls rendered only when `canWriteCatalog(role)`; view-only roles see read-only. HPP page unchanged (already read-only). No page redirect (view roles may open them). |
| Test | pgTAP `catalog_access.test.sql`: production writes ok (create_style, material insert, sku update); sales/finance rejected on those writes; sales can still SELECT `styles`/`materials` (read not broken). Plus fix `create_style.test.sql` fixture (add `user_role`,`owner` to its JWT claims — else the new fn guard denies it). |

## Keputusan desain (detail)

- **Guard roles must match between fn and RLS.** `create_style_with_skus` inserts into `skus`, which will now carry a restrictive write-policy — the fn's allowed-role set (`owner`/`production`/`inventory`) must equal the skus write-policy's, or a legitimately-allowed caller would pass the fn guard then be denied by RLS. They are identical by design.
- **`styles`/`colorways` get no new RLS.** Their only write path is `create_style_with_skus` (verify during impl — grep for other `insert into public.styles`/`colorways` outside the seeder). Gating the fn is sufficient; adding RLS there risks nothing but is unnecessary (YAGNI).
- **NULL-role = deny.** Same fail-closed contract as the P1–P3 guards: a missing `user_role` claim denies writes (`coalesce(v_role in (...), false)` in the fn; strict `in (...)` in RLS, which is NULL→deny).
- **Sidebar view-vs-write.** Group items are visibility-gated to the union of view+write roles; the write/read distinction lives in the page's controls, not the sidebar.

## Testing

pgTAP as above + browser check across the two new accounts (`prod.demo` sees Produk group + can create a style; `inv.demo` same; `sales.demo` has no Produk group and a direct `create_style_with_skus` RPC / catalog write is rejected; a `finance`-or-`ops` view of Styles shows no create button). Full regression suite must stay green — pay attention to `create_style.test.sql` (exercises `create_style_with_skus` under an owner-equivalent tenant; add a `user_role` claim to its JWT fixture if it lacks one, same fix as `planning.test.sql`).
