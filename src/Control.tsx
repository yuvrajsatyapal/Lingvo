import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api, errorText, useBackendEvent,
  type AudioSource, type DownloadEvent, type HistoryEntry, type ModelList, type Settings, type Status,
} from './api'
import { LANGUAGE_OPTIONS, langName } from './langs'
import { LiveTranscript, SaveTranscript } from './Transcript'
import { Translator } from './Translator'

type Tab = 'translate' | 'translator' | 'subtitles' | 'models' | 'history'

const TAB_LABEL: Record<Tab, string> = {
  translate: 'Live',
  translator: 'Translator',
  subtitles: 'Subtitles',
  models: 'Models',
  history: 'History',
}

const STATE_LABEL: Record<Status['state'], string> = {
  idle: 'Idle',
  loading: 'Loading model',
  listening: 'Listening',
  recognizing: 'Recognizing speech',
  translating: 'Translating',
  error: 'Error',
}

const IDLE: Status = { state: 'idle', message: null, detectedLang: null, running: false, sessionId: null }

export function Control() {
  const [tab, setTab] = useState<Tab>('translate')
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

  const speechModel = models?.whisper.find((m) => m.id === settings?.whisperModel)
  const speechKey = `whisper:${settings?.whisperModel}`

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

  const usesWhisperTranslate = settings.targetLang === 'en' && settings.englishViaWhisper && speechModel?.supportsTranslate !== false
  const needsModel = speechModel && !speechModel.installed

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <h1>Lingvo</h1>
            <p>Watch anything. Understand everything.</p>
          </div>
        </div>
        <span className={`pill pill-${status.state}`}>
          <span className="dot" />{STATE_LABEL[status.state]}
        </span>
      </header>

      <nav className="tabs" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="content">
        {tab === 'translate' && (
          <>
            <section className="mode">
              <div className="segmented" role="radiogroup" aria-label="Mode">
                {(['subtitles', 'transcript'] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={settings.outputMode === m}
                    className={settings.outputMode === m ? 'active' : ''}
                    onClick={() => update({ outputMode: m })}
                  >
                    {m === 'subtitles' ? 'Subtitles' : 'Transcript'}
                  </button>
                ))}
              </div>
              <p className="hint">
                {settings.outputMode === 'subtitles'
                  ? 'Floating subtitles over your video.'
                  : 'No overlay. Saves every line as original and translation while the video plays.'}
              </p>
            </section>

            <section className="run">
              <button
                className={`run-button ${status.running ? 'running' : ''}`}
                onClick={toggleRun}
                disabled={busy || (!status.running && !!needsModel)}
              >
                {status.running ? 'Stop translation' : 'Start translation'}
              </button>
              <div className="meter" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>
              <p className="run-note">
                {status.message
                  ?? (status.running
                    ? status.detectedLang
                      ? `Hearing ${langName(status.detectedLang)}`
                      : 'Play a video. Subtitles appear a second or two after speech.'
                    : 'Captures the audio your computer plays. Nothing leaves this device.')}
              </p>
            </section>

            {needsModel && (
              <ModelPrompt
                title={`The ${speechModel.name} speech model is needed (${speechModel.sizeMb} MB)`}
                progress={downloads[speechKey]}
                onDownload={() => download(speechKey)}
              />
            )}

            <section className="card">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.speakTranslation}
                  onChange={(e) => update({ speakTranslation: e.target.checked })}
                />
                <span>Speak the translation aloud</span>
              </label>
              {settings.speakTranslation && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.muteOriginal}
                    onChange={(e) => update({ muteOriginal: e.target.checked })}
                  />
                  <span>Mute the original audio while translating</span>
                </label>
              )}
              <p className="hint">
                {settings.speakTranslation
                  ? `Each finished sentence is spoken in ${langName(settings.targetLang)}, a moment after it is said.`
                  : 'Hear the translation as a voice-over, as well as reading it.'}
              </p>
            </section>

            {settings.outputMode === 'transcript' && (
              <LiveTranscript sessionId={status.sessionId} running={status.running} onError={setError} />
            )}

            <section className="card">
              <div className="pair">
                <label>
                  <span>Spoken language</span>
                  <select value={settings.sourceLang} onChange={(e) => update({ sourceLang: e.target.value })}>
                    <option value="auto">Detect automatically</option>
                    {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
                <span className="arrow" aria-hidden="true">→</span>
                <label>
                  <span>Subtitles in</span>
                  <select value={settings.targetLang} onChange={(e) => update({ targetLang: e.target.value })}>
                    {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
              </div>
              <p className="hint">
                {usesWhisperTranslate
                  ? 'English subtitles work out of the box, no translation model needed.'
                  : `Needs a translation model for each spoken language (see Models).`}
              </p>
            </section>

            <section className="card">
              <label>
                <span>Audio source</span>
                <select value={settings.audioSource} onChange={(e) => update({ audioSource: e.target.value })}>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <div className="row">
                <label>
                  <span>Speech model</span>
                  <select value={settings.whisperModel} onChange={(e) => update({ whisperModel: e.target.value })}>
                    {models?.whisper.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.installed ? '' : ' (not downloaded)'}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Speed</span>
                  <div className="segmented">
                    {(['fast', 'accurate'] as const).map((m) => (
                      <button key={m} className={settings.mode === m ? 'active' : ''} onClick={() => update({ mode: m })}>
                        {m === 'fast' ? 'Fast' : 'Accurate'}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
              {settings.targetLang === 'en' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.englishViaWhisper}
                    onChange={(e) => update({ englishViaWhisper: e.target.checked })}
                  />
                  <span>Translate to English in one step (faster)</span>
                </label>
              )}
            </section>
          </>
        )}

        {tab === 'translator' && <Translator settings={settings} onError={setError} />}

        {tab === 'subtitles' && (
          <SubtitleSettings
            settings={settings}
            update={update}
            visible={overlayVisible}
            edit={overlayEdit}
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

        {tab === 'history' && <History settings={settings} update={update} onError={setError} />}
      </main>
    </div>
  )
}

function ModelPrompt(props: { title: string; progress?: DownloadEvent; onDownload: () => void }) {
  const { progress } = props
  return (
    <div className="banner banner-info">
      <span>{props.title}</span>
      {progress?.status === 'progress'
        ? <Progress event={progress} />
        : <button className="small primary" onClick={props.onDownload}>Download</button>}
    </div>
  )
}

function Progress({ event }: { event: DownloadEvent }) {
  const pct = event.total ? Math.round((event.done / event.total) * 100) : null
  return (
    <span className="progress" role="progressbar" aria-valuenow={pct ?? undefined}>
      <span className="progress-bar"><i style={{ width: `${pct ?? 30}%` }} /></span>
      <span className="progress-label">{pct === null ? `${Math.round(event.done / 1e6)} MB` : `${pct}%`}</span>
    </span>
  )
}

function SubtitleSettings(props: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  visible: boolean
  edit: boolean
}) {
  const { settings, update, visible, edit } = props
  const style = settings.overlay
  const set = (patch: Partial<Settings['overlay']>) => update({ overlay: { ...style, ...patch } })

  return (
    <>
      <section className="card">
        <div className="row">
          <button className="wide" onClick={() => api.setOverlayVisible(!visible)}>
            {visible ? 'Hide subtitles' : 'Show subtitles'}
          </button>
          <button className={`wide ${edit ? 'primary' : ''}`} onClick={() => api.setOverlayEdit(!edit)}>
            {edit ? 'Finish moving' : 'Move and resize'}
          </button>
        </div>
        <p className="hint">Press ⌘⇧L anywhere to hide or show subtitles. Clicks pass through them to the video.</p>
      </section>

      <section className="card">
        <label>
          <span>Text size <em>{style.fontSize}px</em></span>
          <input type="range" min={16} max={72} value={style.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
        </label>
        <label>
          <span>Background opacity <em>{Math.round(style.bgOpacity * 100)}%</em></span>
          <input type="range" min={0} max={100} value={Math.round(style.bgOpacity * 100)} onChange={(e) => set({ bgOpacity: Number(e.target.value) / 100 })} />
        </label>
        <div className="row">
          <label>
            <span>Text color</span>
            <input type="color" value={style.textColor} onChange={(e) => set({ textColor: e.target.value })} />
          </label>
          <label>
            <span>Background color</span>
            <input type="color" value={style.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />
          </label>
          <label>
            <span>Lines</span>
            <div className="segmented">
              {[1, 2, 3].map((n) => (
                <button key={n} className={style.maxLines === n ? 'active' : ''} onClick={() => set({ maxLines: n })}>{n}</button>
              ))}
            </div>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={style.showOriginal} onChange={(e) => set({ showOriginal: e.target.checked })} />
          <span>Also show the original words</span>
        </label>
      </section>

      <section className="preview" aria-label="Subtitle preview">
        <div
          className="subtitle"
          style={{
            color: style.textColor,
            background: `color-mix(in srgb, ${style.bgColor} ${Math.round(style.bgOpacity * 100)}%, transparent)`,
            fontSize: Math.min(style.fontSize, 30),
          }}
        >
          {style.showOriginal && <div className="subtitle-original">¿Dónde está la estación de tren?</div>}
          <div className="subtitle-text"><span>Where is the train station?</span></div>
        </div>
      </section>
    </>
  )
}

function Models(props: {
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

  const action = (key: string, installed: boolean) => {
    const d = downloads[key]
    if (d?.status === 'progress') return <Progress event={d} />
    if (installed) return <button className="small" onClick={() => onDelete(key)}>Remove</button>
    return <button className="small primary" onClick={() => onDownload(key)}>Download</button>
  }

  return (
    <>
      <section className="card">
        <h2>Speech recognition</h2>
        <ul className="list">
          {models.whisper.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.name}</strong> <span className="muted">{m.sizeMb} MB</span>
                <p className="muted">{m.note}</p>
              </div>
              {action(`whisper:${m.id}`, m.installed)}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Translation</h2>
        <p className="hint">
          Each model translates one direction. Pairs without English go through English, so they need two models.
        </p>
        <input
          type="search"
          placeholder="Search languages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} />
          <span>Only models for {langName(settings.targetLang)} subtitles</span>
        </label>
        {models.translationError && (
          <div className="banner banner-error">
            <span>{models.translationError}</span>
            <button className="link" onClick={props.onRefresh}>Retry</button>
          </div>
        )}
        {packages.length === 0 && !models.translationError && <p className="muted">No models match.</p>}
        <ul className="list">
          {packages.map((p) => {
            const key = `translate:${p.fromCode}:${p.toCode}`
            return (
              <li key={key}>
                <div><strong>{p.fromName}</strong> → <strong>{p.toName}</strong></div>
                {action(key, p.installed)}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

function History(props: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  onError: (message: string | null) => void
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const load = useCallback(() => {
    api.getHistory(200).then((h) => setEntries(h ?? [])).catch(() => setEntries([]))
  }, [])

  useEffect(load, [load])
  useBackendEvent<{ isFinal: boolean }>('subtitle', (s) => {
    if (s.isFinal) load()
  })

  const time = (utc: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(utc))

  return (
    <section className="card">
      <div className="row between">
        <label className="check">
          <input
            type="checkbox"
            checked={props.settings.saveHistory}
            onChange={(e) => props.update({ saveHistory: e.target.checked })}
          />
          <span>Keep translated text on this device</span>
        </label>
        <button
          className="small"
          disabled={!entries?.length}
          onClick={() => api.clearHistory().then(load).catch(() => undefined)}
        >
          Clear
        </button>
      </div>
      {!!entries?.length && <SaveTranscript sessionId={null} label="Save all as a text file" onError={props.onError} />}
      {entries === null && <p className="muted">Loading…</p>}
      {entries?.length === 0 && (
        <p className="muted empty">Translated lines will be listed here. Audio is never saved.</p>
      )}
      <ul className="history">
        {entries?.map((e) => (
          <li key={e.id}>
            <p>{e.translated}</p>
            {e.original && <p className="muted">{e.original}</p>}
            <span className="stamp">{time(e.createdAt)}{e.sourceLang ? ` · ${langName(e.sourceLang)}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
