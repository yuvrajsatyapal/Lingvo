import type { ReactNode } from 'react'

const PATHS = {
  live: 'M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2',
  translate: 'M4 5h9M8.5 3v2M6 5c.5 4 3 7 6.5 8.5M12 5c-.5 3-3 6.5-7 8.5M13 21l4-10 4 10M14.5 17.5h5',
  subtitles: 'M7 11h4M13 11h4M7 15h2M12 15h5M6 5h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V8a3 3 0 013-3z',
  sessions: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  models: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  mic: 'M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  swap: 'M8 3L4 7l4 4M4 7h12M16 21l4-4-4-4M20 17H8',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zM17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12',
  copy: 'M10.5 8h7a2.5 2.5 0 012.5 2.5v7a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 018 17.5v-7A2.5 2.5 0 0110.5 8zM16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8',
  back: 'M15 6l-6 6 6 6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5',
  chevron: 'M6 9l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  file: 'M6 3h8l4 4v14H6V3zM14 3v5h4M9 13h6M9 17h6',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg className={`icon ${small ? 'icon-sm' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function PlayGlyph() {
  return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 001.5.86l10-6.5a1 1 0 000-1.72l-10-6.5A1 1 0 008 5.5z" /></svg>
}

export function StopGlyph() {
  return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
}

export function Switch(props: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="switch"
      onClick={() => props.onChange(!props.checked)}
    />
  )
}

export function Segmented<T extends string | number>(props: {
  value: T
  options: readonly (readonly [T, ReactNode])[]
  onChange: (next: T) => void
  label?: string
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={props.value === v}
          className={props.value === v ? 'on' : ''}
          onClick={() => props.onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** A setting row: title and explanation on the left, control on the right. */
export function Option(props: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="option">
      <div>
        <b>{props.title}</b>
        {props.note && <span className="note">{props.note}</span>}
      </div>
      {props.children}
    </div>
  )
}

export function Empty(props: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{props.title}</h3>
      {props.children && <p>{props.children}</p>}
      {props.action}
    </div>
  )
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${Math.max(1, s)} sec`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function clock(utc: string): string {
  return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function dayLabel(utc: string): string {
  const d = new Date(utc)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(d)
}
