import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, errorText, useBackendEvent,
  type AudioSource, type DownloadEvent, type ModelList, type Settings, type Status,
} from './api'
import { langName } from './langs'
import { Live } from './Live'
import { Models } from './Models'
import { Sessions } from './Sessions'
import { Subtitles } from './Subtitles'
import { Translator } from './Translator'
import { Icon, type IconName } from './ui'

type Tab = 'live' | 'translate' | 'subtitles' | 'sessions' | 'models'

const TABS: [Tab, string][] = [
  ['live', 'Live'],
  ['translate', 'Translate'],
  ['subtitles', 'Subtitles'],
  ['sessions', 'Sessions'],
  ['models', 'Models'],
]

const IDLE: Status = { state: 'idle', message: null, detectedLang: null, running: false, sessionId: null }

export function Control() {
  const [tab, setTab] = useState<Tab>('live')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status>(IDLE)
  const [sources, setSources] = useState<AudioSource[]>([])
  const [models, setModels] = useState<ModelList | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DownloadEvent>>({})
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [overlayEdit, setOverlayEdit] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }, [])

  const refreshModels = useCallback(async (refresh: boolean) => {
    try {
      setModels(await api.listModels(refresh))
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => setError(errorText(e)))
    api.getStatus().then(setStatus).catch(() => setStatus(IDLE))
    api.listAudioSources().then(setSources).catch(() => setSources([]))
    api.getOverlayState().then(([visible, edit]) => {
      setOverlayVisible(visible)
      setOverlayEdit(edit)
    }).catch(() => undefined)
    refreshModels(true)
  }, [refreshModels])

  useBackendEvent<Status>('status', (s) => {
    setStatus(s)
    if (!s.running) setLevel(0)
  })
  useBackendEvent<number>('level', setLevel)
  useBackendEvent<boolean>('overlay-visible', setOverlayVisible)
  useBackendEvent<boolean>('overlay-edit', setOverlayEdit)
  useBackendEvent<DownloadEvent>('download', (d) => {
    setDownloads((prev) => {
      const next = { ...prev }
      if (d.status === 'done') delete next[d.key]
      else next[d.key] = d
      return next
    })
    if (d.status === 'done') refreshModels(false)
  })

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      api.saveSettings(next).catch((e) => setError(errorText(e)))
      return next
    })
  }, [])

  const download = useCallback((key: string) => {
    setError(null)
    api.downloadModel(key).catch((e) => setError(errorText(e)))
  }, [])

  const remove = useCallback(async (key: string) => {
    try {
      await api.deleteModel(key)
      await refreshModels(false)
    } catch (e) {
      setError(errorText(e))
    }
  }, [refreshModels])

  const toggleRun = async () => {
    setBusy(true)
    setError(null)
    try {
      if (status.running) await api.stop()
      else await api.start()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return <div className="app"><p className="muted pad">{error ?? 'Loading…'}</p></div>
  }

  const pillText = !status.running
    ? status.state === 'error' ? 'Error' : 'Idle'
    : status.state === 'loading' ? 'Loading model'
      : status.detectedLang ? `Listening · ${langName(status.detectedLang)}` : 'Listening'

  return (
    <div className="app">
      <header className="top">
        <div className="wordmark">
          <span className="mark" aria-hidden="true"><i /><i /><i /></span>
          Lingvo
        </div>
        <span className={`pill ${status.running ? 'on' : ''} ${status.state === 'error' ? 'bad' : ''}`}>
          <span className="dot" />{pillText}
        </span>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="screen" key={tab}>
        {tab === 'live' && (
          <Live
            settings={settings}
            update={update}
            status={status}
            level={level}
            sources={sources}
            models={models}
            downloads={downloads}
            busy={busy}
            onToggle={toggleRun}
            onDownload={download}
            onError={setError}
            notify={notify}
          />
        )}
        {tab === 'translate' && <Translator settings={settings} onError={setError} notify={notify} />}
        {tab === 'subtitles' && <Subtitles settings={settings} update={update} visible={overlayVisible} edit={overlayEdit} />}
        {tab === 'sessions' && (
          <Sessions
            settings={settings}
            update={update}
            liveSessionId={status.running ? status.sessionId : null}
            goLive={() => setTab('live')}
            onError={setError}
            notify={notify}
          />
        )}
        {tab === 'models' && (
          <Models
            models={models}
            settings={settings}
            downloads={downloads}
            onDownload={download}
            onDelete={remove}
            onRefresh={() => refreshModels(true)}
          />
        )}
      </main>

      <nav className="nav" role="tablist" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <Icon name={t as IconName} />
            {label}
            {t === 'sessions' && status.running && <span className="nav-badge" aria-label="Recording" />}
          </button>
        ))}
      </nav>

      <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  )
}
