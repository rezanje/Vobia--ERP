import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import PpoForm from './PpoForm'
import { rp } from '@/lib/ui'

const PCB_STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  final: { label: 'Final', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

const SCHEME_META: Record<string, { label: string; c: string; bg: string }> = {
  fob: { label: 'FOB', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  cmt: { label: 'CMT', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
}

const PPO_STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  issued: { label: 'Diterbitkan', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  closed: { label: 'Selesai', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function PcbDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!canViewPpic(await getRole())) redirect('/')
  const { id } = await params
  const supabase = await createClient()

  const { data: pcb } = await supabase.from('pcb').select('*').eq('id', id).single()
  if (!pcb) notFound()

  const { data: lines } = await supabase
    .from('pcb_lines')
    .select('id, style_id, target_sales, ending_stock, supply_qty, unit_cost, total')
    .eq('pcb_id', id)

  const styleIds = (lines ?? []).map((l) => l.style_id)
  const { data: styles } = await supabase
    .from('styles')
    .select('id, code, name')
    .in('id', styleIds.length ? styleIds : ['00000000-0000-0000-0000-000000000000'])
  const styleLabel = new Map((styles ?? []).map((s) => [s.id, `${s.code} · ${s.name}`]))

  const { data: ppos } = await supabase
    .from('ppo')
    .select('id, code, style_id, scheme, qty, status')
    .eq('pcb_id', id)
    .order('created_at', { ascending: false })

  const meta = PCB_STATUS_META[pcb.status] ?? { label: pcb.status, c: 'var(--vb-muted)', bg: 'transparent' }
  const total = (lines ?? []).reduce((s, l) => s + Number(l.total), 0)

  return (
    <div>
      <Link href="/pcb" className="vb-back">← PCB</Link>
      <div style={{ marginBottom: 16 }}>
        <h1 className="vb-h1">
          {pcb.code}
          <span className="vb-badge" style={{ background: meta.bg, color: meta.c, marginLeft: 8 }}>{meta.label}</span>
        </h1>
        <div className="vb-sub">Kuartal {pcb.quarter}</div>
      </div>

      <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 100px 100px 110px 110px 120px' }}>
          <div>Style</div><div>Target</div><div>End Stock</div><div>Kebutuhan</div><div>Biaya/unit</div><div>Subtotal</div>
        </div>
        {!lines?.length ? (
          <div className="vb-empty">Belum ada baris.</div>
        ) : lines.map((l) => (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 100px 100px 110px 110px 120px' }}>
            <div style={{ fontSize: 12.5 }}>{styleLabel.get(l.style_id) ?? l.style_id}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.target_sales}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.ending_stock}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.supply_qty}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{rp(Number(l.unit_cost))}</div>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{rp(Number(l.total))}</div>
          </div>
        ))}
        {!!lines?.length && (
          <div className="vb-row" style={{ gridTemplateColumns: '1.4fr 100px 100px 110px 110px 120px', fontWeight: 600 }}>
            <div>Total roll-up kuartalan</div><div /><div /><div /><div />
            <div className="vb-mono">{rp(total)}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 1.2fr 90px 70px 110px' }}>
            <div>Kode</div><div>Style</div><div>Scheme</div><div>Qty</div><div>Status</div>
          </div>
          {!ppos?.length ? (
            <div className="vb-empty">Belum ada PPO dari PCB ini.</div>
          ) : ppos.map((p) => {
            const scheme = SCHEME_META[p.scheme] ?? { label: p.scheme, c: 'var(--vb-muted)', bg: 'transparent' }
            const status = PPO_STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <Link key={p.id} href={`/ppo/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1fr 1.2fr 90px 70px 110px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.code}</div>
                <div style={{ fontSize: 12.5 }}>{styleLabel.get(p.style_id) ?? p.style_id}</div>
                <div><span className="vb-badge" style={{ background: scheme.bg, color: scheme.c }}>{scheme.label}</span></div>
                <div className="vb-mono" style={{ fontSize: 12.5 }}>{p.qty}</div>
                <div><span className="vb-badge" style={{ background: status.bg, color: status.c }}>{status.label}</span></div>
              </Link>
            )
          })}
        </div>
        <PpoForm
          pcbId={pcb.id}
          lines={(lines ?? []).map((l) => ({ style_id: l.style_id, label: styleLabel.get(l.style_id) ?? l.style_id, supply_qty: Number(l.supply_qty) }))}
        />
      </div>
    </div>
  )
}
