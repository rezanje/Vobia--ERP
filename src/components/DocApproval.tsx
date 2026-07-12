'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { approveDocument } from '@/lib/documents/actions'

export function DocBadge({ approved }: { approved: boolean }) {
  return (
    <span
      className="vb-badge"
      style={{
        background: approved ? 'var(--vb-accent)' : 'var(--vb-border)',
        color: approved ? 'var(--vb-accent-ink)' : 'var(--vb-muted)',
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      {approved ? 'Resmi' : 'Draft'}
    </span>
  )
}

export function DocActions(props: {
  kind: 'production' | 'purchase'
  id: string
  approved: boolean
  canApprove: boolean
  suratHref: string
}) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  if (props.approved) {
    return <Link href={props.suratHref} className="vb-btn">Cetak Surat</Link>
  }
  if (!props.canApprove) {
    return <span className="vb-muted" style={{ fontSize: 12 }}>Menunggu ACC dari owner/ops.</span>
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button
        className="vb-btn"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await approveDocument({ kind: props.kind, id: props.id })
          if (r?.error) setErr(r.error)
        })}
      >
        {pending ? 'Memproses…' : 'ACC'}
      </button>
      {err && <span style={{ color: 'var(--vb-danger)', fontSize: 12 }}>{err}</span>}
    </div>
  )
}
