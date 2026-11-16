import { useMemo, useState } from 'react'
import type { DownloadEvent, ModelList, Settings } from './api'
import { langName } from './langs'
import { Icon, Switch } from './ui'

/** Rough size of one translation package, used only for the storage summary. */
const TRANSLATION_MB = 95

export function DownloadProgress({ event }: { event: DownloadEvent }) {
  const pct = event.total ? Math.round((event.done / event.total) * 100) : null
  return (
    <span className="prog" role="progressbar" aria-valuenow={pct ?? undefined}>
      <span className="bar"><i style={{ width: `${pct ?? 30}%` }} /></span>
      <span className="prog-label">{pct === null ? `${Math.round(event.done / 1e6)} MB` : `${pct}%`}</span>
    </span>
  )
}

export function Models(props: {
  models: ModelList | null
  settings: Settings
  downloads: Record<string, DownloadEvent>
  onDownload: (key: string) => void
  onDelete: (key: string) => void
  onRefresh: () => void
}) {
  const { models, settings, downloads, onDownload, onDelete } = props
  const [query, setQuery] = useState('')
  const [onlyRelevant, setOnlyRelevant] = useState(true)

  const packages = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (models?.translation ?? []).filter((p) => {
      if (q) return `${p.fromName} ${p.toName}`.toLowerCase().includes(q)
      if (!onlyRelevant) return true
      return p.installed || p.toCode === settings.targetLang || (settings.targetLang !== 'en' && p.toCode === 'en')
    })
  }, [models, query, onlyRelevant, settings.targetLang])

  if (!models) return <p className="muted pad">Loading models…</p>

  const installedSpeech = models.whisper.filter((m) => m.installed)
  const installedTranslation = models.translation.filter((p) => p.installed)
  const usedMb = installedSpeech.reduce((sum, m) => sum + m.sizeMb, 0) + installedTranslation.length * TRANSLATION_MB
  const count = installedSpeech.length + installedTranslation.length
  const usedLabel = usedMb >= 1000 ? `${(usedMb / 1000).toFixed(1)} GB` : `${usedMb} MB`

  const action = (key: string, installed: boolean, removable = true) => {
    const d = downloads[key]
    if (d?.status === 'progress') return <DownloadProgress event={d} />
    if (installed) return <button className="btn small" disabled={!removable} onClick={() => onDelete(key)}>Remove</button>
    return <button className="btn primary small" onClick={() => onDownload(key)}><Icon name="download" small />Get</button>
  }

  return (
    <>
      <div className="heading"><h1>Models</h1><p>Everything runs on this device. Download once, use offline.</p></div>

      <section className="card">
        <div><b className="big">{usedLabel}</b> <span className="muted">used by {count} {count === 1 ? 'model' : 'models'}</span></div>
        <div className="bar"><i style={{ width: `${Math.min(100, usedMb / 30)}%` }} /></div>
      </section>

      <h2 className="label">Speech recognition</h2>
      <section className="card flush">
        {models.whisper.map((m) => {
          const inUse = m.id === settings.whisperModel
          return (
            <div key={m.id} className="mrow">
              <div>
                <b>{m.name}{m.recommended && <span className="tag">Recommended</span>}{inUse && <span className="tag tag-use">In use</span>}</b> <span className="muted">{m.sizeMb} MB</span>
                <span className="note">{m.note}</span>
              </div>
              {action(`whisper:${m.id}`, m.installed, !inUse)}
            </div>
          )
        })}
      </section>

      <h2 className="label">Translation</h2>
      <p className="hint pull-up">Each model translates one direction. Pairs without English go through English, so they need two models.</p>
      <label className="search">
        <Icon name="search" small />
        <input type="search" placeholder="Search languages" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="row between">
        <span className="check">Only models for {langName(settings.targetLang)} subtitles</span>
        <Switch label="Only relevant models" checked={onlyRelevant} onChange={setOnlyRelevant} />
      </div>
      {models.translationError && (
        <div className="banner error">
          <span>{models.translationError}</span>
          <button className="link" onClick={props.onRefresh}>Retry</button>
        </div>
      )}
      <section className="card flush">
        {packages.length === 0 && !models.translationError && <p className="tx-empty">No models match.</p>}
        {packages.map((p) => {
          const key = `translate:${p.fromCode}:${p.toCode}`
          return (
            <div key={key} className="mrow">
              <div><b>{p.fromName}</b> <span className="muted">→</span> <b>{p.toName}</b></div>
              {action(key, p.installed)}
            </div>
          )
        })}
      </section>
    </>
  )
}
