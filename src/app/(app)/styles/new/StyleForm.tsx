'use client'
import { useMemo, useState } from 'react'
import { createStyle, type ColorwayInput } from '@/lib/products/actions'
import { resolveSkuCode, overrideKey } from '@/lib/products/skuCode'

const ALL_SIZES = ['S', 'M', 'L', 'XL']

export default function StyleForm() {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <input className="vb-input" placeholder="Style code (VB-MIRA)" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="vb-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="vb-input" placeholder="Collection" value={collection} onChange={(e) => setCollection(e.target.value)} />
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Colorways</div>
        {colorways.map((cw, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input className="vb-input" placeholder="Color name (Black)" value={cw.color_name}
              onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_name: e.target.value } : c)))} />
            <input className="vb-input" placeholder="Code (BLK)" value={cw.color_code}
              onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_code: e.target.value } : c)))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setColorways((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setColorways((p) => [...p, { color_name: '', color_code: '' }])}>+ colorway</button>
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Sizes</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {ALL_SIZES.map((s) => (
            <span key={s} className={`vb-chip ${sizes.includes(s) ? 'on' : ''}`} onClick={() => toggleSize(s)}>{s}</span>
          ))}
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Preview — {rows.length} SKU (editable)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {rows.map((r) => (
            <input key={r.key} className="vb-input" value={r.codeVal}
              onChange={(e) => setOverrides((p) => ({ ...p, [r.key]: e.target.value }))} />
          ))}
        </div>
      </div>

      <div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : `Save style + ${rows.length} SKUs`}
        </button>
      </div>
    </div>
  )
}
