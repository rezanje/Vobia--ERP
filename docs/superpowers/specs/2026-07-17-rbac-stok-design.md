# RBAC Stok Increment — Design

Per-module RBAC rollout, increment 8 (the sensitive one: stock ledgers). Follows the merged Catalog/Produksi/Penjualan/Lokasi/Pembelian increments. Matrix source: `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md` (rows "Styles/Stok/Bahan/HPP" line 24, "Pembelian/Stok Bahan" line 27).

## Goal

Gate the direct, user-initiated stock-write actions that are still ungated:

1. **Finished-goods stock** (`/stock`) — adjustment, transfer, opname → write `owner/production/inventory`.
2. **Material stock** (`/material-stock`) — adjustment → write `owner/ops/inventory`.
3. **Material issue to production** (`/production/[id]` IssueSection) → `owner/production/inventory`.

Reads stay tenant-wide. The two surfaces have **asymmetric** role sets by matrix design: `ops` is view-only on finished stock; `production` has no access to material stock.

## Architecture

Both ledgers (`stock_ledger`, `material_ledger`) have **only `for select` RLS** (tenant_isolation) — direct insert/update/delete is denied for everyone; every write goes through a `security definer` function. RLS therefore never applies to the write path, so **this increment adds NO new RLS** — the role gate is purely **in-body**, same pattern as `receive_purchase` / `lock_projection`.

The wrinkle: `record_movement` and `record_material_movement` are **shared primitives** called by already-gated parent flows (`create_order`→sale_out, `receive_purchase`→purchase_in, `issue_material_to_po`→issue_out, `record_transfer`→transfer_in/out, production/return fns→production_in/return_in) **and** directly by the UI for adjustments. A blanket guard would break the parent flows. Solution: **guard only the `adjustment` movement_type** inside these two fns; flow types pass through untouched (they are gated upstream).

`record_transfer` and `issue_material_to_po` are only ever user-initiated → **blanket** guard.

## DB Enforcement

Migration `supabase/migrations/20260717000010_rbac_stok.sql`. Each function is `create or replace` — **body copied verbatim from its LATEST deployed definition** (grep all migrations for the fn name; later migrations re-declare), adding only the `v_role` decl + guard. Fail-closed `coalesce(v_role not in (...), true)` (NULL role → raise). Bahasa Indonesia messages. No `grant execute` needed (unchanged arg types preserve grants).

| Function | Latest def to copy from | Guard | Role set |
|---|---|---|---|
| `record_movement(uuid,integer,text,text,text,uuid,uuid)` | `20260709000004_record_movement_v2.sql` | inside the `if p_movement_type='adjustment'` branch only | `owner/production/inventory` |
| `record_material_movement(uuid,numeric,text,text,text,uuid,uuid)` | `20260710000002_record_material_movement.sql` | inside the `if p_movement_type='adjustment'` branch only | `owner/ops/inventory` |
| `record_transfer(uuid,integer,uuid,uuid,text)` | `20260709000005_record_transfer.sql` | blanket, top of body | `owner/production/inventory` |
| `issue_material_to_po(uuid,jsonb,uuid)` | `20260713000003_gate_on_approval.sql` ⚠️ | blanket, top of body | `owner/production/inventory` |

⚠️ `issue_material_to_po`'s latest def carries the **approval gate** (`doc_status='approved'`, var `v_ds`, message "production order belum di-ACC"). Copy from `20260713000003`, NOT the older `20260710000006` — dropping the approval gate is a regression (this is the exact trap from the Pembelian increment).

For the two adjustment-guarded fns: place the guard **inside** the existing `if p_movement_type = 'adjustment' then` block (before the existing reason-required check), so only adjustments are gated:

```sql
-- record_movement (finished goods):
if p_movement_type = 'adjustment' then
  if coalesce(v_role not in ('owner','production','inventory'), true) then
    raise exception 'hanya role Produksi/Inventory/Owner yang boleh menyesuaikan stok';
  end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'adjustment requires a reason'; end if;
  v_qty := p_qty;
elsif ...

-- record_material_movement (materials) — same shape, different set + message:
--   if coalesce(v_role not in ('owner','ops','inventory'), true) then
--     raise exception 'hanya role Ops/Inventory/Owner yang boleh menyesuaikan stok bahan';
```

Add `v_role text := auth.jwt() ->> 'user_role';` to each fn's DECLARE.

## UI Enforcement

Helper in `src/lib/auth/role.ts` (append; match existing arrow style):

```ts
// Stok (barang jadi) + issue bahan ke produksi.
export const canWriteStock = (role: string | null) => role === 'owner' || role === 'production' || role === 'inventory'
```

Material-stock adjustment reuses the existing `canWritePurchasing` (identical `owner/ops/inventory` set; matrix groups Pembelian + Stok Bahan on one row). No second helper.

Page gating (all server components; render the write control for writers, a read-only `vb-card` note otherwise, following the Pembelian `page.tsx` pattern):

- `src/app/(app)/stock/page.tsx` — currently renders `TransferForm` / `AdjustForm` / `OpnameForm` unconditionally and does NOT fetch role. Add `import { getRole, canWriteStock }`, `const canWrite = canWriteStock(await getRole())`, and gate all three forms behind `canWrite` (note: "Hanya role Produksi/Inventory/Owner yang bisa mengubah stok.").
- `src/app/(app)/material-stock/page.tsx` — currently renders `MaterialAdjustForm` unconditionally, no role fetch. Add `import { getRole, canWritePurchasing }`, `const canWrite = canWritePurchasing(await getRole())`, gate `MaterialAdjustForm` (note: "Hanya role Ops/Inventory/Owner yang bisa menyesuaikan stok bahan.").
- `src/app/(app)/production/[id]/page.tsx` — already fetches `const role = await getRole()`. Add `canWriteStock` to the role import + `const canIssue = canWriteStock(role)`, and pass it into the existing `IssueSection` `disabled` prop (prepend `!canIssue ||` to the current expression). `IssueSection` already has a `disabled` prop that hides the issue control — no change to that component.

## Sidebar (`src/components/SideNav.tsx`)

Both items currently ungated. Add `roles` (view roles included so 👁 roles still see the menu; the read-only page shows them the note):

- `{ label: 'Stok', href: '/stock' }` → add `roles: ['owner', 'production', 'inventory', 'ops', 'finance']` (sales/viewer hidden).
- `{ label: 'Stok Bahan', href: '/material-stock' }` → add `roles: ['owner', 'ops', 'inventory', 'finance']` (this is the item deferred-ungated by the Pembelian increment).

## Testing

New pgTAP `supabase/tests/stok_access.test.sql` (seed base data as postgres/RLS-bypassed, switch JWT per role). The asymmetric denials are the point:

- **inventory**: `record_movement('adjustment')` ✓ AND `record_material_movement('adjustment')` ✓.
- **production**: finished-goods adjustment ✓ AND `issue_material_to_po` ✓ (on an approved prod order), BUT material adjustment **blocked**.
- **ops**: material adjustment ✓, BUT finished-goods adjustment **blocked** (ops view-only on /stock); `record_transfer` **blocked** (owner/production/inventory only).
- **finance**: every write blocked; `select` on both ledgers still returns rows (reads intact).
- **regression**: a flow-type movement still works for its normal role — e.g. `record_movement(sku, -1, 'sale_out')` succeeds as `sales`/`ops` (proves the adjustment-only guard did NOT gate flow types). Denials use exception-catch (`begin ... exception when others then v_failed := true; end`).

Then full regression: `node scripts/pgtap.mjs supabase/tests/*.test.sql` must stay green. Any pre-existing fixture that calls these fns with `adjustment` under a JWT lacking `user_role` fails closed → add `'user_role','owner'` additively (do not loosen guards). `stock_ledger.test.sql` / `stock_location.test.sql` are the likely candidates — but their direct `record_movement` calls that use flow types are unaffected; only their `adjustment` calls need a claim.

Push via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (no Docker).

## Out of Scope

- No new demo account (`inv.demo`, `prod.demo`, `ops.demo`, `finance.demo` all seeded).
- No new RLS; no schema change.
- The `record_transfer` finished-goods transfer and `postOpname` both funnel through `record_movement` — opname uses `movement_type='adjustment'` so it is covered by the adjustment guard; transfer is covered by the `record_transfer` blanket guard.
- No material-transfer fn exists — nothing to gate there.

## Tasks (for the plan)

~6, same recipe: (1) migration fn-guards, (2) push + pgTAP + fixture fixes, (3) `role.ts` helper, (4) sidebar, (5) UI gating (stock + material-stock + IssueSection), (6) E2E verify. Opus whole-branch review before merge (touches the ledger write path — warranted).
