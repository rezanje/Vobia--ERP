import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrintButton from '@/components/PrintButton'
import { rp } from '@/lib/ui'

export default async function SuratPO({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (!po) notFound()
  if (po.doc_status !== 'approved') redirect(`/purchasing/${id}`)

  const { data: vendor } = await supabase.from('vendors').select('name, contact').eq('id', po.vendor_id).single()
  const { data: lines } = await supabase.from('purchase_lines').select('material_id, qty_ordered, unit_price').eq('po_id', id)
  const matIds = (lines ?? []).map((l) => l.material_id)
  const { data: mats } = await supabase.from('materials').select('id, code, name').in('id', matIds.length ? matIds : ['00000000-0000-0000-0000-000000000000'])
  const matOf = new Map((mats ?? []).map((m) => [m.id, m]))
  const grand = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_price), 0)

  return (
    <div>
      <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 12px' }}><PrintButton /></div>
      <div className="surat">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #1a1a1a', paddingBottom: 12 }}>
          <div>
            <div style={{ fontFamily: 'Arial', fontSize: 22, fontWeight: 700 }}>VOBIA</div>
            <div style={{ fontFamily: 'Arial', fontSize: 11, color: '#666' }}>Fashion Commerce · Jakarta</div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'Arial' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>PURCHASE ORDER</div>
            <div style={{ fontSize: 12, color: '#444' }}>No. {po.code}</div>
            <div style={{ fontSize: 12, color: '#444' }}>Tanggal: {po.order_date}</div>
          </div>
        </div>
        <div style={{ marginTop: 16, fontFamily: 'Arial', fontSize: 12.5 }}>
          <div style={{ color: '#888', fontSize: 11 }}>KEPADA (SUPPLIER)</div>
          <div style={{ fontWeight: 700 }}>{vendor?.name}</div>
          <div style={{ color: '#555' }}>{vendor?.contact ?? ''}</div>
        </div>
        <table style={{ marginTop: 18 }}>
          <thead><tr style={{ background: '#f4f4f4' }}><th style={{ textAlign: 'left' }}>Bahan</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Harga</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => {
              const m = matOf.get(l.material_id)
              const sub = Number(l.qty_ordered) * Number(l.unit_price)
              return (<tr key={i}><td>{m ? `${m.code} — ${m.name}` : l.material_id}</td><td style={{ textAlign: 'right' }}>{l.qty_ordered}</td><td style={{ textAlign: 'right' }}>{rp(Number(l.unit_price))}</td><td style={{ textAlign: 'right' }}>{rp(sub)}</td></tr>)
            })}
            <tr style={{ fontWeight: 700, background: '#fafafa' }}><td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}>{rp(grand)}</td></tr>
          </tbody>
        </table>
        {po.notes && <div style={{ marginTop: 14, fontFamily: 'Arial', fontSize: 12 }}><span style={{ color: '#888' }}>Catatan: </span>{po.notes}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 40, fontFamily: 'Arial', fontSize: 12.5, textAlign: 'center' }}>
          <div>
            <div style={{ color: '#555' }}>Disetujui (ACC),</div>
            <div style={{ height: 52 }} />
            <div style={{ fontWeight: 700, borderTop: '1px solid #999', paddingTop: 4, minWidth: 180 }}>
              {po.approved_at ? new Date(po.approved_at).toLocaleDateString('id-ID') : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
