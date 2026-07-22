'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDemandPlan, seedDemandPlan, setPlanningParams } from '@/lib/planning/actions'
import { createProductionOrder } from '@/lib/production/actions'

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

// Nilai `month` dari Postgres selalu 'YYYY-MM-DD'. Dibaca sebagai teks, bukan lewat
// new Date(), supaya timezone tidak menggeser bulannya mundur sehari.
const monthLabel = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const monthShort = (iso: string) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3)

type SummaryRow = {
  month: string
  incoming_cogs: number; incoming_gross: number; beginning_gross: number
  sales_gross: number; sales_net: number; sales_cogs: number
  ending_gross: number; ending_cogs: number
  stock_ratio: number | null; ito: number | null
  gpm: number | null; margin: number | null; roi: number | null
}
type DetailRow = {
  sku_id: string; sku_code: string; month: string; order_month: string
  beginning_qty: number; incoming_qty: number; committed_qty: number; suggested_qty: number
  sales_qty: number; ending_qty: number
  cover_ratio: number | null
}
type SkuStyle = Record<string, { style_id: string; label: string }>
type Vendor = { id: string; name: string; moq: number | null }
type Params = { cover_months: number; selling_days: number; net_rate: number; lead_time_months: number }

const nf = new Intl.NumberFormat('id-ID')

function rupiah(v: number | null) {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${nf.format(Math.round(v / 1e8) / 10)} M`
  if (a >= 1e6) return `${nf.format(Math.round(v / 1e5) / 10)} jt`
  return nf.format(Math.round(v))
}
const num = (v: number | null, d = 2) =>
  v === null || v === undefined ? '—' : nf.format(Math.round(v * 10 ** d) / 10 ** d)
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${nf.format(Math.round(v * 1000) / 10)}%`)

const SUMMARY_ROWS: { key: keyof SummaryRow; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'incoming_cogs', label: 'Belanja Barang Masuk (HPP)', fmt: rupiah },
  { key: 'beginning_gross', label: 'Nilai Stok Awal', fmt: rupiah },
  { key: 'sales_gross', label: 'Penjualan Kotor', fmt: rupiah },
  { key: 'sales_net', label: 'Penjualan Bersih', fmt: rupiah },
  { key: 'sales_cogs', label: 'HPP Penjualan', fmt: rupiah },
  { key: 'ending_gross', label: 'Nilai Stok Akhir', fmt: rupiah },
  { key: 'stock_ratio', label: 'Stock Ratio', fmt: (v) => num(v) },
  { key: 'ito', label: 'ITO', fmt: (v) => num(v) },
  { key: 'gpm', label: 'GPM', fmt: pct },
  { key: 'margin', label: 'Margin', fmt: (v) => (v === null ? '—' : `${num(v)}x`) },
  { key: 'roi', label: 'ROI', fmt: (v) => (v === null ? '—' : `${num(v)}x`) },
]

// Tabel detail dibatasi supaya halaman tetap ringan; jumlah yang disembunyikan
// selalu ditampilkan, tidak dipotong diam-diam.
const DETAIL_LIMIT = 150

export default function StockProjectionClient({
  from, months, focus, summary, detail, params, hasParamsRow, role, error, thisMonth,
  skuStyle, vendors,
}: {
  from: string; months: number; focus: string
  summary: SummaryRow[]; detail: DetailRow[]
  params: Params; hasParamsRow: boolean
  role: string | null; error: string | null
  thisMonth: string
  skuStyle: SkuStyle; vendors: Vendor[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // sengaja tidak import dari @/lib/auth/role — file itu menarik Supabase server client
  // ke bundle browser. Gate sungguhannya tetap di fungsi database.
  const canEditDemand = role === 'owner' || role === 'sales'
  const canEditParams = role === 'owner'
  // cocokkan dengan guard create_production_order di database (Produksi/Owner)
  const canOrder = role === 'owner' || role === 'production'

  const [edits, setEdits] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [cover, setCover] = useState(String(params.cover_months))
  const [days, setDays] = useState(String(params.selling_days))
  const [net, setNet] = useState(String(Math.round(params.net_rate * 100)))
  const [lead, setLead] = useState(String(params.lead_time_months))
  const [vendor, setVendor] = useState('')

  const focusRows = useMemo(
    () => detail.filter((d) => d.month === focus).sort((a, b) => b.suggested_qty - a.suggested_qty || a.sku_code.localeCompare(b.sku_code)),
    [detail, focus],
  )
  const shown = focusRows.slice(0, DETAIL_LIMIT)
  const needOrder = focusRows.filter((r) => r.suggested_qty > 0).length

  // Yang benar-benar dipakai untuk bertindak: order dilihat dari KAPAN HARUS DIPESAN,
  // bukan kapan barang datang. Dihitung dari seluruh horizon, bukan hanya bulan fokus.
  const orders = useMemo(() => detail.filter((d) => d.suggested_qty > 0), [detail])
  const orderNow = useMemo(() => orders.filter((d) => d.order_month === thisMonth), [orders, thisMonth])
  const late = useMemo(() => orders.filter((d) => d.order_month < thisMonth), [orders, thisMonth])

  // Usulan bulan fokus dikelompokkan per style, karena satu order produksi = satu style.
  const byStyle = useMemo(() => {
    const g = new Map<string, { label: string; lines: { sku_id: string; qty_ordered: number }[]; total: number }>()
    for (const d of focusRows) {
      if (d.suggested_qty <= 0) continue
      const s = skuStyle[d.sku_id]
      if (!s) continue
      const e = g.get(s.style_id) ?? { label: s.label, lines: [], total: 0 }
      e.lines.push({ sku_id: d.sku_id, qty_ordered: d.suggested_qty })
      e.total += d.suggested_qty
      g.set(s.style_id, e)
    }
    return [...g.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [focusRows, skuStyle])

  function navigate(patch: Record<string, string>) {
    const q = new URLSearchParams({ from, months: String(months), focus, ...patch })
    startTransition(() => router.push(`/stock-projection?${q}`))
  }

  async function saveDemand() {
    setErr(null); setMsg(null)
    const lines = Object.entries(edits)
      .map(([sku_id, raw]) => ({ sku_id, month: focus, qty: Number(raw) }))
      .filter((l) => Number.isInteger(l.qty) && l.qty >= 0)
    if (!lines.length) { setErr('Tidak ada angka yang diubah (harus bilangan bulat ≥ 0).'); return }
    setSaving(true)
    const res = await setDemandPlan(lines)
    setSaving(false)
    if (res?.error) { setErr(res.error); return }
    setEdits({})
    setMsg(`${lines.length} forecast tersimpan.`)
    startTransition(() => router.refresh())
  }

  async function seed() {
    setErr(null); setMsg(null); setSaving(true)
    const res = await seedDemandPlan(from, months)
    setSaving(false)
    if (res?.error) { setErr(res.error); return }
    setMsg('Forecast diisi dari run-rate penjualan. Angka yang sudah kamu koreksi tidak ditimpa.')
    startTransition(() => router.refresh())
  }

  async function makeOrder(styleId: string, lines: { sku_id: string; qty_ordered: number }[]) {
    setErr(null); setMsg(null)
    if (!vendor) { setErr('Pilih vendor dulu.'); return }
    setSaving(true)
    // deadline = akhir bulan kedatangan; komponen bulan +1 hari 0 = hari terakhir
    const y = Number(focus.slice(0, 4)), m = Number(focus.slice(5, 7))
    const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const res = await createProductionOrder({
      style_id: styleId, vendor_id: vendor, deadline: lastDay,
      notes: `Dari proyeksi stok ${monthLabel(focus)}`, lines,
    })
    setSaving(false)
    if (res?.error) setErr(res.error)
    // sukses = server action redirect ke halaman order produksi
  }

  async function saveParams() {
    setErr(null); setMsg(null)
    const c = Number(cover), d = Number(days), n = Number(net) / 100, l = Number(lead)
    if (!(c > 0 && c <= 12)) { setErr('Cover harus 0–12 bulan.'); return }
    if (!Number.isInteger(d) || d < 1 || d > 31) { setErr('Hari jualan harus 1–31.'); return }
    if (!(n > 0 && n <= 1)) { setErr('Penjualan bersih harus 1–100%.'); return }
    if (!Number.isInteger(l) || l < 0 || l > 12) { setErr('Lead time harus 0–12 bulan.'); return }
    setSaving(true)
    const res = await setPlanningParams({ cover_months: c, selling_days: d, net_rate: n, lead_time_months: l })
    setSaving(false)
    if (res?.error) { setErr(res.error); return }
    setMsg('Asumsi tersimpan. Semua angka proyeksi dihitung ulang.')
    startTransition(() => router.refresh())
  }

  const cols = `220px repeat(${summary.length}, minmax(88px, 1fr))`

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="vb-h1">Proyeksi Stok</h1>
          <div className="vb-sub">
            {summary.length} bulan dari {monthLabel(from)} · stok awal diambil dari saldo stok sungguhan
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label className="vb-label">Mulai</label>
            <input className="vb-input" type="month" value={from.slice(0, 7)} disabled={pending}
              onChange={(e) => e.target.value && navigate({ from: `${e.target.value}-01`, focus: `${e.target.value}-01` })} />
          </div>
          <div>
            <label className="vb-label">Jumlah bulan</label>
            <select className="vb-input" value={months} disabled={pending}
              onChange={(e) => navigate({ months: e.target.value })}>
              {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="vb-danger" style={{ marginBottom: 12, fontSize: 12.5 }}>{error}</div>}
      {err && <div className="vb-danger" style={{ marginBottom: 12, fontSize: 12.5 }}>{err}</div>}
      {msg && <div className="vb-sub" style={{ marginBottom: 12, fontSize: 12.5 }}>{msg}</div>}

      {!hasParamsRow && (
        <div className="vb-card" style={{ padding: 12, marginBottom: 12, fontSize: 12.5, color: 'var(--vb-muted)' }}>
          Asumsi masih bawaan, <strong>belum dikonfirmasi</strong>. Cover {params.cover_months} bulan ·{' '}
          {params.selling_days} hari jualan · bersih {Math.round(params.net_rate * 100)}% dibaca dari spreadsheet client.
          Lead time {params.lead_time_months} bulan belum ada di spreadsheet — itu angka awal yang harus diganti
          dengan waktu produksi sebenarnya.
        </div>
      )}

      {/* Barang butuh waktu dibuat. Yang mendesak bukan "datang bulan ini",
          tapi "harus dipesan bulan ini" — dan yang sudah kelewat. */}
      {(orderNow.length > 0 || late.length > 0) && (
        <div className="vb-card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {late.length > 0 && (
            <div>
              <div className="vb-danger" style={{ fontSize: 13, fontWeight: 600 }}>
                {late.length} SKU sudah lewat waktu pesan
              </div>
              <div className="vb-sub" style={{ fontSize: 12 }}>
                Dengan lead time {params.lead_time_months} bulan, kedatangan yang direncanakan tidak lagi terkejar.
              </div>
            </div>
          )}
          {orderNow.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {orderNow.length} SKU harus dipesan bulan ini
              </div>
              <div className="vb-sub" style={{ fontSize: 12 }}>
                Untuk kedatangan {monthLabel(orderNow[0].month)}.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Ubah usulan jadi order produksi sungguhan ---- */}
      {canOrder && byStyle.length > 0 && (
        <div className="vb-card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div className="vb-cardtitle">Buat Order Produksi · {monthLabel(focus)}</div>
              <div className="vb-sub" style={{ fontSize: 12 }}>
                Satu order per style, qty diambil dari usulan. Setelah dibuat, usulannya hilang sendiri.
              </div>
            </div>
            <select className="vb-input" style={{ minWidth: 200 }} value={vendor}
              onChange={(e) => setVendor(e.target.value)}>
              <option value="">Pilih vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.moq ? ` (MOQ ${nf.format(v.moq)})` : ''}
                </option>
              ))}
            </select>
          </div>
          {byStyle.map(([styleId, g]) => {
            const moq = vendors.find((v) => v.id === vendor)?.moq ?? null
            const belowMoq = moq !== null && g.total < moq
            return (
              <div key={styleId} className="vb-row" style={{ gridTemplateColumns: '1fr 90px 90px 150px' }}>
                <div style={{ fontSize: 12.5 }}>
                  {g.label}
                  {belowMoq && (
                    <div style={{ fontSize: 11, color: '#e08f8f' }}>
                      Di bawah MOQ vendor ({nf.format(moq)}) — gabungkan beberapa bulan atau pesan manual.
                    </div>
                  )}
                </div>
                <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right' }}>{g.lines.length} SKU</div>
                <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{nf.format(g.total)}</div>
                <div style={{ textAlign: 'right' }}>
                  <button type="button" className="vb-btn" disabled={saving || pending || !vendor || belowMoq}
                    onClick={() => makeOrder(styleId, g.lines)}>Buat Order</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ---- Ringkasan bulanan: setara tab "Summary" di spreadsheet ---- */}
      <div className="vb-card" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: cols, minWidth: 720 }}>
          <div>Ringkasan</div>
          {summary.map((s) => (
            <div key={s.month} style={{ textAlign: 'right' }}>{monthShort(s.month)}</div>
          ))}
        </div>
        {!summary.length ? (
          <div className="vb-empty">Belum ada data proyeksi.</div>
        ) : SUMMARY_ROWS.map((r) => (
          <div key={r.key} className="vb-row" style={{ gridTemplateColumns: cols, minWidth: 720 }}>
            <div style={{ fontSize: 12.5 }}>{r.label}</div>
            {summary.map((s) => (
              <div key={s.month} className="vb-mono" style={{ fontSize: 12, textAlign: 'right' }}>
                {r.fmt(s[r.key] as number | null)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ---- Detail per SKU untuk satu bulan ---- */}
      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="vb-cardtitle">Rincian per SKU</div>
            <div className="vb-sub" style={{ fontSize: 12 }}>
              {focusRows.length} SKU · {needOrder} perlu order di {monthLabel(focus)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="vb-input" value={focus} disabled={pending}
              onChange={(e) => navigate({ focus: e.target.value })}>
              {summary.map((s) => <option key={s.month} value={s.month}>{monthLabel(s.month)}</option>)}
            </select>
            {canEditDemand && (
              <>
                <button type="button" className="vb-btn" disabled={saving || pending} onClick={seed}>
                  Isi dari run-rate
                </button>
                <button type="button" className="vb-btn" disabled={saving || pending || !Object.keys(edits).length}
                  onClick={saveDemand}>
                  {saving ? 'Menyimpan…' : `Simpan Forecast${Object.keys(edits).length ? ` (${Object.keys(edits).length})` : ''}`}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 100px 90px 100px 100px 105px 90px 70px' }}>
          <div>SKU</div>
          <div style={{ textAlign: 'right' }}>Forecast Jual</div>
          <div style={{ textAlign: 'right' }}>Stok Awal</div>
          <div style={{ textAlign: 'right' }}>Sudah Dipesan</div>
          <div style={{ textAlign: 'right' }}>Usulan Order</div>
          <div style={{ textAlign: 'right' }}>Pesan Bulan</div>
          <div style={{ textAlign: 'right' }}>Stok Akhir</div>
          <div style={{ textAlign: 'right' }}>Cover</div>
        </div>

        {!shown.length ? (
          <div className="vb-empty">Belum ada SKU aktif untuk bulan ini.</div>
        ) : shown.map((d) => {
          const edited = edits[d.sku_id]
          return (
            <div key={d.sku_id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 100px 90px 100px 100px 105px 90px 70px' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{d.sku_code}</div>
              <div style={{ textAlign: 'right' }}>
                {canEditDemand ? (
                  <input
                    className="vb-input"
                    style={{ textAlign: 'right', padding: '4px 8px', fontSize: 12 }}
                    inputMode="numeric"
                    value={edited ?? String(d.sales_qty)}
                    onChange={(e) => setEdits((p) => ({ ...p, [d.sku_id]: e.target.value }))}
                  />
                ) : (
                  <span className="vb-mono" style={{ fontSize: 12 }}>{nf.format(d.sales_qty)}</span>
                )}
              </div>
              <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right' }}>{nf.format(d.beginning_qty)}</div>
              <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right', color: d.committed_qty > 0 ? '#8fb8e0' : undefined }}>
                {d.committed_qty > 0 ? nf.format(d.committed_qty) : '—'}
              </div>
              <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right', fontWeight: d.suggested_qty > 0 ? 600 : 400 }}>
                {d.suggested_qty > 0 ? nf.format(d.suggested_qty) : '—'}
              </div>
              <div style={{ fontSize: 11.5, textAlign: 'right' }}>
                {d.suggested_qty === 0 ? '—'
                  : d.order_month < thisMonth
                    ? <span className="vb-badge" style={{ background: 'rgba(224,122,122,.13)', color: '#e07a7a' }}>Telat · {monthShort(d.order_month)}</span>
                    : d.order_month === thisMonth
                      ? <span className="vb-badge" style={{ background: 'rgba(227,196,110,.13)', color: '#e3c46e' }}>Sekarang</span>
                      : monthShort(d.order_month)}
              </div>
              <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right', color: d.ending_qty < 0 ? 'var(--vb-danger, #e07a7a)' : undefined }}>
                {nf.format(d.ending_qty)}
              </div>
              <div className="vb-mono" style={{ fontSize: 12, textAlign: 'right' }}>{num(d.cover_ratio)}</div>
            </div>
          )
        })}

        {focusRows.length > DETAIL_LIMIT && (
          <div className="vb-empty" style={{ fontSize: 12 }}>
            {focusRows.length - DETAIL_LIMIT} SKU lain disembunyikan (ditampilkan {DETAIL_LIMIT} teratas menurut usulan order).
          </div>
        )}
      </div>

      {/* ---- Asumsi ---- */}
      {canEditParams && (
        <div className="vb-card" style={{ padding: 18, marginTop: 16, maxWidth: 640 }}>
          <div className="vb-cardtitle" style={{ marginBottom: 4 }}>Asumsi Perencanaan</div>
          <div className="vb-sub" style={{ fontSize: 12, marginBottom: 12 }}>
            Mengubah ini menghitung ulang seluruh proyeksi.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label className="vb-label">Cover stok (bulan)</label>
              <input className="vb-input" inputMode="decimal" value={cover} onChange={(e) => setCover(e.target.value)} />
            </div>
            <div>
              <label className="vb-label">Lead time (bulan)</label>
              <input className="vb-input" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
            </div>
            <div>
              <label className="vb-label">Hari jualan / bulan</label>
              <input className="vb-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <label className="vb-label">Penjualan bersih (%)</label>
              <input className="vb-input" inputMode="numeric" value={net} onChange={(e) => setNet(e.target.value)} />
            </div>
            <button type="button" className="vb-btn" disabled={saving || pending} onClick={saveParams}>Simpan Asumsi</button>
          </div>
        </div>
      )}
    </div>
  )
}
