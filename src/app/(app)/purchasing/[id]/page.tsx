import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReceiveForm from './ReceiveForm'
import { rp } from '@/lib/ui'
import { DocBadge, DocActions } from '@/components/DocApproval'
import { getRole, canApprove } from '@/lib/auth/role'

export default async function PurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (!po) notFound()
  const role = await getRole()
  const approved = po.doc_status === 'approved'

  const { data: lines } = await supabase.from('purchase_lines').select('id, material_id, qty_ordered, unit_price, qty_received').eq('po_id', id)
  const matIds = (lines ?? []).map((l) => l.material_id)
  const { data: materials } = await supabase.from('materials').select('id, code').in('id', matIds.length ? matIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((materials ?? []).map((m) => [m.id, m.code]))
  const { data: vendor } = await supabase.from('vendors').select('name').eq('id', po.vendor_id).single()

  const formLines = (lines ?? []).map((l) => ({
    id: l.id, material_code: codeOf.get(l.material_id) ?? l.material_id,
    qty_ordered: Number(l.qty_ordered), unit_price: Number(l.unit_price), qty_received: Number(l.qty_received),
  }))
  const total = formLines.reduce((s, l) => s + l.qty_ordered * l.unit_price, 0)

  return (
    <div>
      <Link href="/purchasing" className="vb-back">← Pembelian</Link>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 className="vb-h1">{po.code}<DocBadge approved={approved} /></h1>
          <div className="vb-sub">{vendor?.name ?? '—'} · {po.order_date} · {po.status}{po.notes ? ` · ${po.notes}` : ''}</div>
        </div>
        <DocActions kind="purchase" id={po.id} approved={approved} canApprove={canApprove(role)} suratHref={`/purchasing/${po.id}/surat`} />
      </div>
      <div style={{ marginBottom: 12, fontSize: 13 }} className="vb-muted">Nilai PO: <span className="vb-mono">{rp(total)}</span></div>
      {!approved && <div className="vb-empty" style={{ marginBottom: 12 }}>ACC PO dulu sebelum terima barang.</div>}
      <ReceiveForm poId={po.id} lines={formLines} disabled={!approved || po.status === 'canceled' || po.status === 'received'} />
    </div>
  )
}
