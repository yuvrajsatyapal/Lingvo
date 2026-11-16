import { useEffect, useRef, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { api, useBackendEvent, type Settings, type Subtitle } from './api'

const SAMPLE: Subtitle = {
  id: 0,
  text: 'Your translated subtitles appear here. Drag to move, pull an edge to resize.',
  original: 'Aquí aparecen tus subtítulos traducidos.',
  sourceLang: 'es',
  isFinal: true,
  latencyMs: 0,
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function Overlay() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [subtitle, setSubtitle] = useState<Subtitle | null>(null)
  const [edit, setEdit] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings(null))
    api.getOverlayState().then(([, editing]) => setEdit(editing)).catch(() => setEdit(false))
  }, [])

  useBackendEvent<Settings>('settings', setSettings)
  useBackendEvent<boolean>('overlay-edit', setEdit)
  useBackendEvent<Subtitle>('subtitle', (next) => {
    setSubtitle(next)
    window.clearTimeout(hideTimer.current)
    // Longer lines stay up longer; provisional lines are replaced by the next update anyway.
    const hold = Math.min(9000, 2500 + next.text.length * 60)
    hideTimer.current = window.setTimeout(() => setSubtitle(null), hold)
  })
  useBackendEvent<{ running: boolean }>('status', (s) => {
    if (!s.running) setSubtitle(null)
  })

  if (!settings) return null
  const style = settings.overlay
  const shown = edit ? (subtitle ?? SAMPLE) : subtitle

  return (
    <div
      className={`overlay ${edit ? 'overlay-edit' : ''}`}
      onMouseDown={(e) => {
        if (edit && e.button === 0 && !(e.target as HTMLElement).closest('button')) {
          getCurrentWebviewWindow().startDragging()
        }
      }}
    >
      {edit && (
        <button className="overlay-done" onClick={() => api.setOverlayEdit(false)}>
          Done
        </button>
      )}
      {shown && (
        <div
          className="subtitle"
          style={{
            color: style.textColor,
            background: rgba(style.bgColor, style.bgOpacity),
            fontSize: style.fontSize,
          }}
        >
          {style.showOriginal && shown.original && (
            <div className="subtitle-original">{shown.original}</div>
          )}
          <div
            className={`subtitle-text ${shown.isFinal ? '' : 'subtitle-provisional'}`}
            style={{ maxHeight: `${style.maxLines * 1.3}em` }}
          >
            <span>{shown.text}</span>
          </div>
        </div>
      )}
    </div>
  )
}
