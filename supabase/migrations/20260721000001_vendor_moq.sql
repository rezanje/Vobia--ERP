-- MOQ (minimum order quantity) per vendor, dalam unit per order produksi.
-- Aturan dagang hasil nego, bukan integritas data — dicek di UI saat membuat
-- order dari proyeksi, tidak dipaksakan di create_production_order (order manual
-- boleh menyimpang, mis. repeat order kecil yang sudah disepakati vendor).
alter table public.vendors
  add column moq integer check (moq is null or moq > 0);
