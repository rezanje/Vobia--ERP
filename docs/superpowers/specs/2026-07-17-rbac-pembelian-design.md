# RBAC Increment: Pembelian (Purchase Orders + Receive)

**Date:** 2026-07-17
**Goal:** Restrict purchase-order create + goods-receive to `owner`/`ops`/`inventory`; `finance` views; hidden from other roles. Reads stay tenant-wide.
**Depth:** Full — DB fn guards + RLS + UI + pgTAP, same standard as prior increments. 6th legacy-module increment of the B5 RBAC rollout. **Intended for execution in a separate chat session** — this spec + its plan are self-contained.

## Konteks

Follows [[vobia-rbac-sales-ops-built]] (P1–P3, Catalog, Produksi, Penjualan, Lokasi). Full matrix: `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md`. Demo accounts (ops/inventory/finance) already seeded — no new accounts.

Pembelian write surfaces (codebase scan):
- `create_purchase_order(uuid,uuid,date,text,jsonb)` — RPC, **`security invoker`**, writes `purchase_orders`+`purchase_lines`.
- `receive_purchase(uuid,jsonb)` — RPC, **`security definer`** (!), updates `purchase_lines.qty_received` + posts `purchase_in` material stock via `record_material_movement`, flips PO status to `received`.

## ⚠️ Critical cross-flow interactions (read before implementing)

`purchase_orders` / `purchase_lines` are SHARED with the manufacturing flow:
1. **`issue_ppo_pos` (P1–P3 manufacturing, security invoker) writes child POs into `purchase_orders`+`purchase_lines`.** Its own guard already restricts callers to `owner`/`ops`. So the new write-RLS role set on these tables MUST be a superset of `{owner,ops}` — `owner/ops/inventory` satisfies this (an ops user issuing a CMT PPO still passes). Do NOT set the RLS to exclude ops.
2. **`receive_purchase` is `security definer`** — it runs as the function owner (postgres) and RLS does NOT apply to it. Therefore its `purchase_lines.qty_received` UPDATE is NOT blocked by any write-RLS; the ONLY thing gating receive by role is the guard we add INSIDE the function body (same situation as `lock_projection` in the P1–P3 increment). The guard is mandatory, not optional.
3. `create_purchase_order` is `security invoker`, so it writes `purchase_orders`/`purchase_lines` as the calling user and IS subject to the new write-RLS — its fn guard's role set and the RLS role set must match (`owner/ops/inventory`).

## Scope boundary — material adjustment DEFERRED

The `/material-stock` (Stok Bahan) page's manual adjustment (`recordMaterialAdjustment` → `record_material_movement` RPC direct) is a `material_ledger` append-only write and shares the `record_material_movement` primitive with `receive_purchase` and production material-issue. Gating it belongs with the **Stok increment** (alongside the finished-goods `record_movement`/`stock_ledger` and the deferred `IssueSection`). This increment covers ONLY `/purchasing` (PO create + receive). Consequently the sidebar's **"Stok Bahan" item is left ungated** here (like "Stok" was during the Catalog increment); only the **"Pembelian" item** is gated.

## Role sets

| Surface | Write roles |
|---|---|
| `create_purchase_order` (fn guard, invoker) | owner, ops, inventory |
| `receive_purchase` (fn guard, **definer — in-body guard mandatory**) | owner, ops, inventory |
| `purchase_orders`, `purchase_lines` (RLS write) | owner, ops, inventory |

`finance` = view (menu + read-only). `sales`/`production`/`viewer` = no Pembelian menu.

## Perubahan

| Layer | Perubahan |
|---|---|
| Schema | none |
| DB fn | guard `create_purchase_order` + `receive_purchase` → role owner/ops/inventory (fail-closed `coalesce(v_role not in (...), true)`), first check after `v_tenant is null`. Keep `create_purchase_order` invoker, `receive_purchase` **definer** (do NOT change its security mode). |
| DB RLS | RESTRICTIVE per-command write-policies (insert/update/delete, unique names e.g. `buy_write_*`) on `purchase_orders`, `purchase_lines` → owner/ops/inventory. Reads untouched. |
| Demo accounts | none new. |
| role.ts | `canWritePurchasing(role)=owner\|ops\|inventory`. |
| Sidebar | Pembelian group **"Pembelian" item only** → `roles: ['owner','ops','inventory','finance']`. "Stok Bahan" item left as-is (deferred to Stok increment). |
| UI | `purchasing/page.tsx` (`PurchaseForm` → canWritePurchasing else note); `purchasing/[id]/page.tsx` (`ReceiveForm` → canWritePurchasing; the `DocActions` approve control keeps its existing `canApprove` = owner/ops, unchanged). |
| Test | pgTAP `pembelian_access.test.sql`: ops (or inventory) creates a PO + receives it; finance/sales blocked from create + receive (receive via exception-catch on the definer fn's guard) but read intact; + additive `user_role` claim on any broken fixture (esp. `purchasing.test.sql`). |

## Keputusan desain (detail)

- **`receive_purchase` guard placement:** add `v_role text := auth.jwt() ->> 'user_role';` to its declare block and `if coalesce(v_role not in ('owner','ops','inventory'), true) then raise exception 'hanya role Ops/Inventory/Owner yang boleh menerima barang'; end if;` right after the `v_tenant is null` check. Because it is `security definer`, this in-body guard is the sole role enforcement for receive — verify a pgTAP test calls receive under a finance JWT and asserts it raises.
- **RLS role set must include ops** so `issue_ppo_pos` (manufacturing CMT child-PO creation, owner/ops) keeps working — regression-check `planning.test.sql` after the change.
- **Fail-closed:** missing `user_role` claim denies. No `coalesce(...,'owner')` fallback.
- **DocActions unchanged:** approval stays gated by the existing `canApprove` (owner/ops) — not part of this write increment.

## Testing

pgTAP as above + browser: `ops.demo` (or `inv.demo`) creates a PO and receives an approved one; `finance` (no seeded finance account yet — seed one, OR test finance at the pgTAP level only and browser-verify with a role that has no Pembelian menu, e.g. `sales.demo`, seeing no Pembelian group) — note: there is currently NO `finance.demo` account; the executor should either add one to `scripts/seed-users.mjs` for the browser view-check or rely on the pgTAP finance assertions plus a `sales.demo` no-menu check. Full regression suite (esp. `planning.test.sql` for the issue_ppo_pos cross-flow, and `purchasing.test.sql`) stays green.
