import Link from 'next/link'
import StyleForm from './StyleForm'

export default function NewStylePage() {
  return (
    <div style={{ maxWidth: 780 }}>
      <Link href="/styles" className="vb-back">← Styles</Link>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Style Baru</h1>
        <div className="vb-sub">Definisikan style, colorway, dan size — SKU di-generate otomatis</div>
      </div>
      <StyleForm />
    </div>
  )
}
