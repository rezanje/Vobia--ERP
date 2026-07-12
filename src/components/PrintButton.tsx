'use client'
export default function PrintButton() {
  return <button className="vb-btn no-print" onClick={() => window.print()}>Cetak / Simpan PDF</button>
}
