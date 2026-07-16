import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import { rp } from '@/lib/ui'

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  final: { label: 'Final', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function PcbListPage() {
  if (!canViewPpic(await getRole())) redirect('/')
  const supabase = await createClient()
  const { data: pcbs } = await supabase
    .from('pcb')
    .select('id, code, quarter, status, created_at')
    .order('created_at', { ascending: false })

  const pcbIds = (pcbs ?? []).map((p) => p.id)
  const { data: lines } = await supabase
    .from('pcb_lines')
    .select('pcb_id, style_id, total')
    .in('pcb_id', pcbIds.length ? pcbIds : ['00000000-0000-0000-0000-000000000000'])

  const styleCount = new Map<string, number>()
  const totalValue = new Map<string, number>()
  for (const l of lines ?? []) {
    styleCount.set(l.pcb_id, (styleCount.get(l.pcb_id) ?? 0) + 1)
    totalValue.set(l.pcb_id, (totalValue.get(l.pcb_id) ?? 0) + Number(l.total))
  }

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="vb-h1">PCB</h1>
          <div className="vb-sub">{pcbs?.length ?? 0} rencana produksi kuartalan</div>
        </div>
        <Link href="/projections" className="vb-btn">Buat PCB →</Link>
      </div>
      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-thead" style={{ gridTemplateColumns: '1.1fr 110px 130px 1fr 110px' }}>
          <div>Kode</div><div>Kuartal</div><div>Jumlah Style</div><div>Total Nilai</div><div>Status</div>
        </div>
        {!pcbs?.length ? (
          <div className="vb-empty">Belum ada PCB. Buat dari proyeksi yang sudah terkunci.</div>
        ) : pcbs.map((p) => {
          const meta = STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
          return (
            <Link key={p.id} href={`/pcb/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1.1fr 110px 130px 1fr 110px' }}>
              <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.code}</div>
              <div style={{ fontSize: 12.5 }}>{p.quarter}</div>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{styleCount.get(p.id) ?? 0}</div>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{rp(totalValue.get(p.id) ?? 0)}</div>
              <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
