import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrintButton from '@/components/PrintButton'

export default async function SuratSPK({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()
  if (po.doc_status !== 'approved') redirect(`/production/${id}`)

  const { data: style } = await supabase.from('styles').select('name').eq('id', po.style_id).single()
  const { data: vendor } = await supabase.from('vendors').select('name, contact').eq('id', po.vendor_id).single()
  const { data: lines } = await supabase.from('prod_lines').select('sku_id, qty_ordered').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))
  const total = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered), 0)

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
            <div style={{ fontSize: 15, fontWeight: 700 }}>SURAT PERINTAH KERJA</div>
            <div style={{ fontSize: 12, color: '#444' }}>No. {po.code}</div>
            <div style={{ fontSize: 12, color: '#444' }}>Tanggal: {new Date(po.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 32, marginTop: 16, fontFamily: 'Arial', fontSize: 12.5 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#888', fontSize: 11 }}>KEPADA (KONVEKSI)</div>
            <div style={{ fontWeight: 700 }}>{vendor?.name}</div>
            <div style={{ color: '#555' }}>{vendor?.contact ?? ''}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#888', fontSize: 11 }}>DEADLINE</div>
            <div style={{ fontWeight: 700 }}>{po.deadline ?? '—'}</div>
            <div style={{ color: '#555' }}>Style: {style?.name}</div>
          </div>
        </div>
        <table style={{ marginTop: 18 }}>
          <thead><tr style={{ background: '#f4f4f4' }}><th style={{ textAlign: 'left' }}>Kode SKU</th><th style={{ textAlign: 'right' }}>Jumlah</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => (<tr key={i}><td>{codeOf.get(l.sku_id) ?? l.sku_id}</td><td style={{ textAlign: 'right' }}>{l.qty_ordered}</td></tr>))}
            <tr style={{ fontWeight: 700, background: '#fafafa' }}><td>Total unit</td><td style={{ textAlign: 'right' }}>{total}</td></tr>
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
