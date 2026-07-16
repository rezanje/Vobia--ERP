import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IssueForm from './IssueForm'
import PaymentPanel from './PaymentPanel'
import { rp, PO_TYPE_LABEL } from '@/lib/ui'

const SCHEME_META: Record<string, { label: string; c: string; bg: string }> = {
  fob: { label: 'FOB', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  cmt: { label: 'CMT', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
}

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  draft: { label: 'Draft', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  issued: { label: 'Terbit', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  closed: { label: 'Selesai', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
}

export default async function PpoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: ppo } = await supabase.from('ppo').select('*').eq('id', id).single()
  if (!ppo) notFound()

  const { data: style } = await supabase.from('styles').select('code, name').eq('id', ppo.style_id).single()
  const { data: pcb } = await supabase.from('pcb').select('id, code').eq('id', ppo.pcb_id).single()

  const { data: children } = await supabase
    .from('purchase_orders')
    .select('id, code, vendor_id, po_type, amount, doc_status')
    .eq('ppo_id', id)
    .order('created_at', { ascending: true })

  const vendorIds = (children ?? []).map((c) => c.vendor_id)
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name')
    .in('id', vendorIds.length ? vendorIds : ['00000000-0000-0000-0000-000000000000'])
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]))

  const childIds = (children ?? []).map((c) => c.id)
  const { data: payments } = await supabase
    .from('po_payments')
    .select('id, po_id, kind, amount, status, paid_at')
    .in('po_id', childIds.length ? childIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: true })
  const paymentsByPo = new Map<string, typeof payments>()
  for (const p of payments ?? []) {
    const list = paymentsByPo.get(p.po_id) ?? []
    list.push(p)
    paymentsByPo.set(p.po_id, list)
  }

  const { data: activeVendors } = await supabase.from('vendors').select('id, name').eq('active', true).order('name')
  const { data: activeMaterials } = await supabase.from('materials').select('id, code, name').eq('active', true).order('code')

  const scheme = SCHEME_META[ppo.scheme] ?? { label: ppo.scheme, c: 'var(--vb-muted)', bg: 'transparent' }
  const status = STATUS_META[ppo.status] ?? { label: ppo.status, c: 'var(--vb-muted)', bg: 'transparent' }

  return (
    <div>
      {pcb && <Link href={`/pcb/${pcb.id}`} className="vb-back">← PCB {pcb.code}</Link>}
      <div style={{ marginBottom: 16 }}>
        <h1 className="vb-h1">
          {ppo.code}
          <span className="vb-badge" style={{ background: scheme.bg, color: scheme.c, marginLeft: 8 }}>{scheme.label}</span>
          <span className="vb-badge" style={{ background: status.bg, color: status.c, marginLeft: 6 }}>{status.label}</span>
        </h1>
        <div className="vb-sub">{style ? `${style.code} · ${style.name}` : ppo.style_id} · Qty {ppo.qty}</div>
      </div>

      {ppo.status === 'draft' ? (
        <IssueForm ppoId={ppo.id} scheme={ppo.scheme as 'fob' | 'cmt'} vendors={activeVendors ?? []} materials={activeMaterials ?? []} />
      ) : (
        <>
          <div className="vb-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
            <div className="vb-thead" style={{ gridTemplateColumns: '1fr 110px 1.2fr 110px 100px 1.4fr' }}>
              <div>Kode</div><div>Tipe</div><div>Vendor</div><div>Nilai</div><div>Approval</div><div>Pembayaran</div>
            </div>
            {!children?.length ? (
              <div className="vb-empty">Belum ada anak PO.</div>
            ) : children.map((c) => {
              const approved = c.doc_status === 'approved'
              return (
                <div key={c.id} className="vb-row" style={{ gridTemplateColumns: '1fr 110px 1.2fr 110px 100px 1.4fr', alignItems: 'start' }}>
                  <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>
                    {c.po_type === 'material' ? (
                      <Link href={`/purchasing/${c.id}`} style={{ color: 'var(--vb-accent)', textDecoration: 'none' }}>{c.code}</Link>
                    ) : (
                      c.code
                    )}
                  </div>
                  <div style={{ fontSize: 12.5 }}>{PO_TYPE_LABEL[c.po_type] ?? c.po_type}</div>
                  <div style={{ fontSize: 12.5 }}>{vendorName.get(c.vendor_id) ?? '—'}</div>
                  <div className="vb-mono" style={{ fontSize: 12.5 }}>{rp(Number(c.amount))}</div>
                  <div>
                    <span className="vb-badge" style={{ background: approved ? 'var(--vb-accent)' : 'var(--vb-border)', color: approved ? 'var(--vb-accent-ink)' : 'var(--vb-muted)' }}>
                      {approved ? 'ACC' : 'Draft'}
                    </span>
                  </div>
                  <div>
                    <PaymentPanel ppoId={ppo.id} po={{ id: c.id, po_type: c.po_type }} payments={(paymentsByPo.get(c.id) ?? []).map((p) => ({ id: p.id, kind: p.kind, amount: Number(p.amount), status: p.status, paid_at: p.paid_at }))} />
                  </div>
                </div>
              )
            })}
          </div>

          {ppo.scheme === 'cmt' && (
            <div className="vb-muted" style={{ fontSize: 12.5 }}>
              Bahan di-PO terpisah → terima di Pembelian; jahit = SPK Produksi.{' '}
              <Link href="/production/new" style={{ color: 'var(--vb-accent)', textDecoration: 'none' }}>Buat SPK Produksi →</Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
