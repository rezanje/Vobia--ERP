import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'

const SCHEME_META: Record<string, { label: string; c: string; bg: string }> = {
  fob: { label: 'FOB', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  cmt: { label: 'CMT', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
}

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  issued: { label: 'Terbit', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  closed: { label: 'Selesai', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function PpoListPage() {
  if (!canViewPpic(await getRole())) redirect('/')
  const supabase = await createClient()
  const { data: ppos } = await supabase
    .from('ppo')
    .select('id, code, style_id, scheme, qty, status, created_at')
    .order('created_at', { ascending: false })

  const styleIds = (ppos ?? []).map((p) => p.style_id)
  const { data: styles } = await supabase
    .from('styles')
    .select('id, code, name')
    .in('id', styleIds.length ? styleIds : ['00000000-0000-0000-0000-000000000000'])
  const styleLabel = new Map((styles ?? []).map((s) => [s.id, `${s.code} · ${s.name}`]))

  const ppoIds = (ppos ?? []).map((p) => p.id)
  const { data: children } = await supabase
    .from('purchase_orders')
    .select('ppo_id')
    .in('ppo_id', ppoIds.length ? ppoIds : ['00000000-0000-0000-0000-000000000000'])
  const childCount = new Map<string, number>()
  for (const c of children ?? []) {
    if (!c.ppo_id) continue
    childCount.set(c.ppo_id, (childCount.get(c.ppo_id) ?? 0) + 1)
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">PPO</h1>
        <div className="vb-sub">{ppos?.length ?? 0} PO produksi (parent)</div>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1fr 1.4fr 90px 80px 100px 110px' }}>
          <div>Kode</div><div>Style</div><div>Skema</div><div>Qty</div><div>Anak PO</div><div>Status</div>
        </div>
        {!ppos?.length ? (
          <div className="vb-empty">Belum ada PPO. Buat dari halaman PCB.</div>
        ) : ppos.map((p) => {
          const scheme = SCHEME_META[p.scheme] ?? { label: p.scheme, c: 'var(--vb-muted)', bg: 'transparent' }
          const status = STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
          return (
            <Link key={p.id} href={`/ppo/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1fr 1.4fr 90px 80px 100px 110px' }}>
              <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.code}</div>
              <div style={{ fontSize: 12.5 }}>{styleLabel.get(p.style_id) ?? p.style_id}</div>
              <div><span className="vb-badge" style={{ background: scheme.bg, color: scheme.c }}>{scheme.label}</span></div>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{p.qty}</div>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{childCount.get(p.id) ?? 0}</div>
              <div><span className="vb-badge" style={{ background: status.bg, color: status.c }}>{status.label}</span></div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
