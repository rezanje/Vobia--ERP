import { createClient } from '@/lib/supabase/server'
import { getRole } from '@/lib/auth/role'
import StockProjectionClient from './StockProjectionClient'

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/

export default async function StockProjectionPage(props: {
  searchParams: Promise<{ from?: string; months?: string; focus?: string }>
}) {
  const sp = await props.searchParams
  const now = new Date()
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const from = FIRST_OF_MONTH.test(sp.from ?? '') ? sp.from! : defaultFrom
  const months = Math.min(12, Math.max(1, Number(sp.months) || 6))

  const supabase = await createClient()
  const role = await getRole()

  // style per SKU dirakit dari tiga query kecil, bukan select bersarang — types di
  // repo ini ditulis tangan, jadi bentuk datar lebih tahan banting.
  const [
    { data: summary, error: sumErr },
    { data: detail, error: detErr },
    { data: params },
    { data: skus },
    { data: colorways },
    { data: styles },
    { data: vendors },
  ] = await Promise.all([
    supabase.rpc('projection_summary', { p_from: from, p_months: months }),
    supabase.rpc('project_stock', { p_from: from, p_months: months }),
    supabase.from('planning_params').select('cover_months, selling_days, net_rate, lead_time_months').maybeSingle(),
    supabase.from('skus').select('id, colorway_id'),
    supabase.from('colorways').select('id, style_id'),
    supabase.from('styles').select('id, code, name').order('code'),
    supabase.from('vendors').select('id, name, moq').eq('active', true).order('name'),
  ])

  const styleById = new Map((styles ?? []).map((s) => [s.id, s]))
  const styleByColorway = new Map((colorways ?? []).map((c) => [c.id, c.style_id]))
  const skuStyle: Record<string, { style_id: string; label: string }> = {}
  for (const k of skus ?? []) {
    const styleId = styleByColorway.get(k.colorway_id)
    const style = styleId ? styleById.get(styleId) : undefined
    if (styleId && style) skuStyle[k.id] = { style_id: styleId, label: `${style.code} · ${style.name}` }
  }

  const error = sumErr?.message ?? detErr?.message ?? null
  const rows = summary ?? []
  const focus = FIRST_OF_MONTH.test(sp.focus ?? '') && rows.some((r) => r.month === sp.focus)
    ? sp.focus!
    : (rows[0]?.month ?? from)

  return (
    <StockProjectionClient
      from={from}
      months={months}
      focus={focus}
      summary={rows}
      detail={detail ?? []}
      params={params ?? { cover_months: 1.5, selling_days: 27, net_rate: 0.95, lead_time_months: 2 }}
      thisMonth={defaultFrom}
      skuStyle={skuStyle}
      vendors={vendors ?? []}
      hasParamsRow={!!params}
      role={role}
      error={error}
    />
  )
}
