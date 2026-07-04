'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStyle, type ColorwayInput } from '@/lib/products/actions'
import { resolveSkuCode, overrideKey } from '@/lib/products/skuCode'

const ALL_SIZES = ['S', 'M', 'L', 'XL']

export default function StyleForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [collection, setCollection] = useState('')
  const [colorways, setColorways] = useState<ColorwayInput[]>([{ color_name: '', color_code: '' }])
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L'])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = useMemo(() => {
    const out: { key: string; color: string; size: string; codeVal: string }[] = []
    for (const cw of colorways) {
      if (!cw.color_code) continue
      for (const size of sizes) {
        const key = overrideKey(cw.color_code, size)
        out.push({ key, color: cw.color_name || cw.color_code, size, codeVal: resolveSkuCode(code, cw.color_code, size, overrides) })
      }
    }
    return out
  }, [colorways, sizes, code, overrides])

  function toggleSize(s: string) {
    setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    const res = await createStyle({ code, name, collection, colorways: colorways.filter((c) => c.color_code), sizes, overrides })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="vb-danger">{error}</div>}

      <div className="vb-card" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1.6fr 1.3fr', gap: 12 }}>
          <div>
            <label className="vb-label">Kode</label>
            <input className="vb-input" placeholder="VB-KJ06" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <label className="vb-label">Nama</label>
            <input className="vb-input" placeholder="Nama style" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="vb-label">Koleksi</label>
            <input className="vb-input" placeholder="Tarunggana Vol. 03" value={collection} onChange={(e) => setCollection(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="vb-card" style={{ padding: 18 }}>
        <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Colorway</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {colorways.map((cw, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 130px 34px', gap: 8, alignItems: 'center' }}>
              <input className="vb-input" placeholder="Batik Navy" value={cw.color_name}
                onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_name: e.target.value } : c)))} />
              <input className="vb-input vb-mono" placeholder="BNV" value={cw.color_code}
                onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_code: e.target.value } : c)))} />
              <button className="vb-btn-x" type="button" onClick={() => setColorways((p) => p.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button className="vb-btn-line" style={{ marginTop: 10 }} type="button" onClick={() => setColorways((p) => [...p, { color_name: '', color_code: '' }])}>+ Tambah colorway</button>
      </div>

      <div className="vb-card" style={{ padding: 18 }}>
        <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Size</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ALL_SIZES.map((s) => (
            <div key={s} className={`vb-chip ${sizes.includes(s) ? 'on' : ''}`} onClick={() => toggleSize(s)}>{s}</div>
          ))}
        </div>
      </div>

      <div className="vb-card" style={{ overflow: 'hidden' }}>
        <div className="vb-cardtitle" style={{ padding: '16px 18px 12px' }}>Preview SKU</div>
        {rows.length ? (
          <>
            <div className="vb-thead" style={{ gridTemplateColumns: '1.3fr 70px 1.6fr', padding: '8px 18px' }}>
              <div>Colorway</div><div>Size</div><div>Kode SKU</div>
            </div>
            {rows.map((r) => (
              <div key={r.key} className="vb-row" style={{ gridTemplateColumns: '1.3fr 70px 1.6fr', padding: '6px 18px' }}>
                <div>{r.color}</div>
                <div className="vb-mono">{r.size}</div>
                <input className="vb-input vb-mono" style={{ padding: '6px 9px', fontSize: 12.5 }} value={r.codeVal}
                  onChange={(e) => setOverrides((p) => ({ ...p, [r.key]: e.target.value }))} />
              </div>
            ))}
          </>
        ) : (
          <div style={{ padding: '0 18px 18px', color: 'var(--vb-dim)', fontSize: 12.5 }}>Isi kode style, minimal satu colorway (dengan kode), dan pilih size untuk melihat preview SKU.</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="vb-btn-ghost" type="button" onClick={() => router.push('/styles')}>Batal</button>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Menyimpan…' : 'Simpan Style'}
        </button>
      </div>
    </div>
  )
}
