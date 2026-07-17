# RBAC Increment: Produksi (Production orders, Vendor, HPP cost entries)

**Date:** 2026-07-17
**Goal:** Extend the role model to the Produksi modules — production orders + stage transitions + QC receiving restricted to `owner`/`production`; Vendor create opened to `owner`/`production`/`ops` (master data used by procurement too); production cost entries (HPP) restricted to `owner`/`production`/`inventory`. Menu hidden from roles without access; catalog-style READ-stays-open.
**Depth:** Full — DB write guards + RLS + UI, same standard as the P1–P3 and Catalog increments. Second legacy-module increment of the B5 RBAC rollout. Also lands the `cost_entries`/HPP write-gate deferred from the Catalog increment (its write UI lives here, on the production-order detail page).

## Konteks

Follows [[vobia-rbac-sales-ops-built]] (P1–P3) and the Catalog increment. Full matrix: `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md`. Demo accounts `production`/`inventory`/`ops`/`sales` already seeded (`scripts/seed-users.mjs`) — no new accounts.

Produksi write surfaces (codebase scan):
- `create_production_order(uuid,uuid,date,text,jsonb)` — RPC, `security invoker`, writes `production_orders`+`prod_lines`.
- `transition_production_stage(uuid,text)` — RPC, `security invoker`, updates `production_orders.stage` (trial→mass→qc→completed; on `completed` it calls `record_movement` to post finished-goods stock).
- `prod_lines.update` — direct (`src/lib/production/actions.ts`), QC receiving (qty_received/reject_count).
- `vendors.insert` — direct (`src/lib/production/actions.ts`), Vendor.
- `cost_entries.insert` — direct (`src/lib/costing/actions.ts`), production cost / HPP, on the production-order detail page.

## Keputusan desain — WRITE-only gating, READ stays tenant-wide

Same lesson as [[vobia-rbac-sales-ops-built]] and the Catalog increment: `vendors` is read cross-module (procurement/PPO issue pick vendors; production reads vendors), and `prod_lines`/`cost_entries` feed the `sku_hpp` view read by the HPP page (viewable by ops/finance). RLS-blocking their SELECT would break those. So gate WRITE only; leave every `tenant_isolation` SELECT policy untouched; no page redirects. "No access" = sidebar-hidden + no write controls. Reads via direct URL render read-only.

## Role sets

| Surface | Write roles |
|---|---|
| `create_production_order` (fn guard) | owner, production |
| `transition_production_stage` (fn guard) | owner, production |
| `production_orders` (RLS write) | owner, production |
| `prod_lines` (RLS write) | owner, production |
| `vendors` (RLS write) | owner, production, **ops** (master data; procurement needs it) |
| `cost_entries` (RLS write) | owner, production, inventory |

`ops` = view on Produksi orders (sees them, can't write). `sales`/`finance`/`viewer`/`inventory` = no Produksi menu.

## Perubahan

| Layer | Perubahan |
|---|---|
| Schema | none |
| DB fn | guard `create_production_order` + `transition_production_stage` → role must be owner/production (fail-closed `coalesce(v_role not in (...), true)`), first check after `v_tenant is null`. |
| DB RLS | RESTRICTIVE per-command write-policies (`catalog_write_*`-style, insert/update/delete, unique names) on: `production_orders` (o/p), `prod_lines` (o/p), `vendors` (o/p/ops), `cost_entries` (o/p/inv). Reads untouched. |
| Demo accounts | none new. |
| role.ts | `canWriteProduction(role)=owner\|production`; `canWriteVendor(role)=owner\|production\|ops`; `canWriteCost(role)=owner\|production\|inventory`. |
| Sidebar | Produksi group items (Produksi, Vendor) → `roles: ['owner','production','ops']` (hidden for sales/inventory/finance/viewer). |
| UI | `production/page.tsx` (`+ Order Produksi` link → canWriteProduction); `production/[id]/page.tsx` (already fetches `role`) → pass canWriteProduction to `StageButtons` (hide transition buttons) + `ProdLineRow` (read-only qty/reject), pass canWriteCost to render `CostForm` or a note; `vendors/page.tsx` (`VendorForm` → canWriteVendor, else note). |
| Test | pgTAP `production_access.test.sql`: production creates PO + transitions + updates prod_line + inserts cost; ops creates a vendor but is blocked from create_production_order / transition / prod_line update; sales blocked from all + vendor; sales reads production_orders/vendors intact. Plus additive `user_role` claim on any pre-existing fixture writing these tables. |

## Deferred (not this increment)

- **Material issue** (`IssueSection` on the production detail page → `issue_material_to_po` → `material_ledger`): append-only ledger domain, belongs to the later **Stok/material** increment (same reason `record_movement`/stock is deferred). Left ungated here (DB + UI), consistent with how `cost_entries` was left during the Catalog increment.
- **Document approval** (`DocActions`) already uses the existing `canApprove` (owner/ops) — unchanged.

## Keputusan desain (detail)

- **production_orders/prod_lines RLS despite fn-only writes:** the two RPCs are the only app write path, but a direct PostgREST write would bypass them — the Catalog final-review lesson (add RLS to fn-written tables too, e.g. styles/colorways) applies, so both tables get restrictive write-RLS matching the fn guard's role set.
- **`transition_production_stage`→`record_movement` on completed:** the transition is gated (owner/production), so only they trigger the finished-goods stock post. `record_movement` itself is not role-gated yet (Stok increment) — fine, it's reached only through the gated transition.
- **Fn/RLS role-set parity:** `create_production_order` (security invoker) inserts into `production_orders`+`prod_lines`, now carrying restrictive write-RLS with the same owner/production set — a legit caller passes both.
- **Fail-closed:** missing `user_role` claim denies (fn `coalesce(..., true)`, RLS strict `in`). No `coalesce(...,'owner')` fallback.

## Testing

pgTAP as above + browser: `prod.demo` (production) creates/transitions a PO, updates QC, adds a cost, creates a vendor; `ops.demo` sees Produksi orders read-only, can create a vendor, cannot create/transition a PO (button hidden + direct RPC rejected); `sales.demo` has no Produksi menu, `/production` read-only via URL. Full regression suite stays green.
