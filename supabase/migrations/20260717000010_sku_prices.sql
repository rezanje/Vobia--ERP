-- Master price fields on SKU: COGS + retail (selling) price, imported from the
-- client's SKU bank spreadsheet. Nullable — not every SKU has a price yet.
alter table public.skus
  add column cogs numeric(14,2),
  add column retail_price numeric(14,2);
