import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rp } from '@/lib/ui'
import PrintButton from '@/components/PrintButton'

export default async function SlipPage({ params }: { params: Promise<{ id: string; psId: string }> }) {
  const { id, psId } = await params
  const supabase = await createClient()
  const { data: ps } = await supabase.from('payslips').select('*').eq('id', psId).single()
  if (!ps || ps.run_id !== id) notFound()
  const { data: run } = await supabase.from('payroll_runs').select('period').eq('id', id).single()
  const { data: emp } = await supabase.from('employees').select('name, position, bank_account').eq('id', ps.employee_id).single()
  const { data: lines } = await supabase.from('payslip_lines').select('label, kind, amount').eq('payslip_id', psId)

  const tunjangan = (lines ?? []).filter((l) => l.kind === 'tunjangan')
  const potongan = (lines ?? []).filter((l) => l.kind === 'potongan' || l.kind === 'pajak')

  return (
    <div>
      <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 12px' }}><PrintButton /></div>
      <div className="surat">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #1a1a1a', paddingBottom: 12 }}>
          <div>
            <div style={{ fontFamily: 'Arial', fontSize: 22, fontWeight: 700 }}>VOBIA</div>
            <div style={{ fontFamily: 'Arial', fontSize: 11, color: '#666' }}>Slip Gaji</div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'Arial' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{emp?.name}</div>
            <div style={{ fontSize: 12, color: '#444' }}>{emp?.position ?? ''}</div>
            <div style={{ fontSize: 12, color: '#444' }}>Periode: {run?.period}</div>
          </div>
        </div>

        <table style={{ marginTop: 18 }}>
          <tbody>
            <tr><td style={{ fontWeight: 700, background: '#f4f4f4' }} colSpan={2}>Penerimaan</td></tr>
            <tr><td>Gaji Pokok</td><td style={{ textAlign: 'right' }}>{rp(Number(ps.base_salary))}</td></tr>
            {tunjangan.map((l, i) => (<tr key={i}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{rp(Number(l.amount))}</td></tr>))}
            {Number(ps.overtime) > 0 && <tr><td>Lembur</td><td style={{ textAlign: 'right' }}>{rp(Number(ps.overtime))}</td></tr>}
            <tr style={{ fontWeight: 700 }}><td>Total Penerimaan (Bruto)</td><td style={{ textAlign: 'right' }}>{rp(Number(ps.gross))}</td></tr>

            <tr><td style={{ fontWeight: 700, background: '#f4f4f4' }} colSpan={2}>Potongan</td></tr>
            {potongan.length ? potongan.map((l, i) => (<tr key={i}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{rp(Number(l.amount))}</td></tr>))
              : <tr><td colSpan={2} style={{ color: '#888' }}>Tidak ada potongan</td></tr>}
            <tr style={{ fontWeight: 700 }}><td>Total Potongan</td><td style={{ textAlign: 'right' }}>{rp(Number(ps.deduction_total) + Number(ps.tax_total))}</td></tr>
          </tbody>
        </table>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f4f4f4', padding: '12px 14px', fontFamily: 'Arial' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Gaji Bersih (Netto)</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Rp {rp(Number(ps.net))}</div>
        </div>
        {emp?.bank_account && <div style={{ marginTop: 10, fontFamily: 'Arial', fontSize: 12, color: '#555' }}>Transfer ke: {emp.bank_account}</div>}
      </div>
    </div>
  )
}
