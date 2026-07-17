# RBAC Increment: Lokasi

**Date:** 2026-07-17
**Goal:** Restrict location create to `owner`/`ops`; `inventory` views; hidden from other roles. Reads stay tenant-wide (default-location lookup is cross-module).
**Depth:** Full — RLS + UI + pgTAP. Smallest B5 increment (one table, one direct-insert form, no RPC).

## Konteks

Follows [[vobia-rbac-sales-ops-built]] (P1–P3, Catalog, Produksi, Penjualan). Full matrix: `docs/superpowers/specs/2026-07-17-role-based-access-sales-ops-design.md`. Demo accounts already seeded — no new accounts.

Sole write surface: `locations.insert` — direct table write (`src/lib/locations/actions.ts` `createLocation`). No RPC.

## Keventuan desain — WRITE-only gating, READ tenant-wide (critical)

`locations` is read across many flows: `create_purchase_order`/`receive_purchase`/`create_production_order`/`issue_ppo_pos`/material-issue/transfers all resolve the tenant's default location by reading `locations`. RLS-blocking SELECT would break the entire receive/issue/produce chain. So gate WRITE only; leave `tenant_isolation` SELECT untouched. The new-user trigger `handle_new_user` and migration seeds insert locations as `security definer`/postgres, bypassing RLS — unaffected.

## Role sets

| Surface | Write roles |
|---|---|
| `locations` (RLS insert/update/delete) | owner, ops |

`inventory` = view (menu + read-only). `sales`/`production`/`finance`/`viewer` = no Pengaturan/Lokasi menu.

## Perubahan

| Layer | Perubahan |
|---|---|
| Schema | none |
| DB | RESTRICTIVE per-command write-policies (`loc_write_insert`/`loc_write_update`/`loc_write_delete`) on `locations` → owner/ops. `tenant_isolation` SELECT untouched. No fn (direct insert only). |
| Demo accounts | none new |
| role.ts | `canWriteLocation(role)=owner\|ops` |
| Sidebar | Pengaturan group item Lokasi → `roles: ['owner','ops','inventory']` |
| UI | `locations/page.tsx` (`LocationForm` → canWriteLocation else a note) |
| Test | pgTAP `lokasi_access.test.sql`: ops inserts a location; sales + inventory blocked from insert but read intact |

## Keputusan desain (detail)

- **Fail-closed:** RLS strict `(auth.jwt()->>'user_role') in ('owner','ops')` (NULL → deny). No fail-open fallback.
- **No fn guard:** there's no RPC write path for locations — the restrictive RLS is the whole DB gate (covers both the app's direct `createLocation` and any direct PostgREST write).
- **inventory writes?** No — matrix has inventory as view-only for Lokasi. The Pengaturan menu is visible to inventory (view) but the LocationForm is gated to owner/ops.

## Testing

pgTAP as above + browser: `ops.demo` sees Pengaturan→Lokasi + the Lokasi Baru form and can add a location; a non-write role that still sees the menu (inventory) sees the read-only note; a role with no menu (sales) has no Pengaturan group. Full regression suite stays green.
