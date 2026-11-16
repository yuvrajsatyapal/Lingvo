import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, useBackendEvent,
  type AudioSource, type DownloadEvent, type HistoryEntry, type ModelList, type Settings, type Status, type Subtitle,
} from './api'
import { LANGUAGE_OPTIONS, langName } from './langs'
import { PlayGlyph, StopGlyph, Icon, Option, Segmented, Switch, clock } from './ui'
import { DownloadProgress } from './Models'
import { SubtitleBlock } from './Subtitles'

const STATE_NOTE: Record<Status['state'], string> = {
  idle: 'Captures audio your computer plays. Nothing leaves this device.',
  loading: 'This only takes a moment.',
  listening: 'Subtitles appear a second or two after speech.',
  recognizing: 'Subtitles appear a second or two after speech.',
  translating: 'Subtitles appear a second or two after speech.',
  error: '',
}

const BARS = 32

/** Bars driven by the engine's input level; flat when nothing is running. */
function Wave({ level, active }: { level: number; active: boolean }) {
  const [heights, setHeights] = useState<number[]>(() => Array(BARS).fill(4))
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    if (!active) {
      setHeights(Array(BARS).fill(4))
      return
    }
    const id = window.setInterval(() => {
      const lift = Math.sqrt(Math.min(1, levelRef.current))
      setHeights(Array.from({ length: BARS }, (_, i) => {
        const edge = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
        return 4 + lift * (0.35 + Math.random() * 0.65) * 30 * (1 - edge * 0.65)
      }))
    }, 110)
    return () => window.clearInterval(id)
  }, [active])

  return (
    <div className={`wave ${active ? 'on' : ''}`} aria-hidden="true">
      {heights.map((h, i) => <i key={i} style={{ height: h }} />)}
    </div>
  )
}

function LiveTranscript(props: { sessionId: number | null; running: boolean; onError: (m: string | null) => void; notify: (m: string) => void }) {
  const { sessionId } = props
  const [lines, setLines] = useState<HistoryEntry[]>([])
  const [pending, setPending] = useState<Subtitle | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    if (sessionId === null) {
      setLines([])
      return
    }
    api.getHistory(1000, sessionId)
      .then((h) => setLines([...(h ?? [])].reverse()))
      .catch(() => setLines([]))
  }, [sessionId])

  useEffect(load, [load])
  useBackendEvent<Subtitle>('subtitle', (s) => {
    if (s.isFinal) {
      setPending(null)
      load()
    } else {
      setPending(s)
    }
  })
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, pending])

  const copy = () => {
    const text = lines.map((l) => (l.original ? `${l.original}\n→ ${l.translated}` : l.translated)).join('\n\n')
    navigator.clipboard.writeText(text)
      .then(() => props.notify('Transcript copied'))
      .catch(() => props.onError('Could not copy the transcript.'))
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <span className="label">Transcript{lines.length ? ` · ${lines.length} lines` : ''}</span>
        <button className="ghost" disabled={!lines.length} onClick={copy}><Icon name="copy" small />Copy</button>
      </div>
      <div className="tx" ref={box} aria-live="polite">
        {!lines.length && !pending && (
          <p className="tx-empty">{props.running ? 'Listening. Lines appear here as people speak.' : 'Press start, then play a video.'}</p>
        )}
        {lines.map((l) => (
          <div key={l.id} className="tx-line">
            <span className="time">{clock(l.createdAt)}</span>
            <div>
              {l.original && <p className="orig">{l.original}</p>}
              <p className="trans">{l.translated}</p>
            </div>
          </div>
        ))}
        {pending && props.running && (
          <div className="tx-line pending">
            <span className="time">now</span>
            <div><p className="trans">{pending.text} <span className="dots"><i /><i /><i /></span></p></div>
          </div>
        )}
      </div>
    </div>
  )
}

function OverlayPreview({ settings, last }: { settings: Settings; last: Subtitle | null }) {
  return (
    <div className="card">
      <div className="card-head tight">
        <span className="label">On your screen</span>
        <span className="hint">Press <kbd>⌘⇧L</kbd> to hide</span>
      </div>
      <div className="scene compact">
        <SubtitleBlock
          style={settings.overlay}
          original={last?.original ?? '¿Dónde está la estación de tren?'}
          text={last?.text ?? 'Where is the train station?'}
          scale={0.62}
        />
      </div>
    </div>
  )
}

export function Live(props: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  status: Status
  level: number
  sources: AudioSource[]
  models: ModelList | null
  downloads: Record<string, DownloadEvent>
  busy: boolean
  onToggle: () => void
  onDownload: (key: string) => void
  onError: (m: string | null) => void
  notify: (m: string) => void
}) {
  const { settings, update, status, models } = props
  const [advanced, setAdvanced] = useState(false)
  const [lastSub, setLastSub] = useState<Subtitle | null>(null)
  useBackendEvent<Subtitle>('subtitle', (s) => { if (s.isFinal) setLastSub(s) })

  const speechModel = models?.whisper.find((m) => m.id === settings.whisperModel)
  const speechKey = `whisper:${settings.whisperModel}`
  const needsModel = !!speechModel && !speechModel.installed
  const usesOneStep = settings.targetLang === 'en' && settings.englishViaWhisper && speechModel?.supportsTranslate !== false
  const loading = status.state === 'loading'

  const headline = status.running
    ? loading ? 'Loading model…'
      : status.detectedLang ? `Hearing ${langName(status.detectedLang)}` : 'Listening…'
    : needsModel ? 'Download a model to begin' : 'Ready when you are'
  const note = status.message ?? STATE_NOTE[status.state]

  return (
    <>
      <Segmented
        label="Output"
        value={settings.outputMode}
        options={[['subtitles', 'Floating subtitles'], ['transcript', 'Transcript']] as const}
        onChange={(outputMode) => update({ outputMode })}
      />

      <div className="langs">
        <label className="lang-box">
          <small>Spoken</small>
          <select value={settings.sourceLang} onChange={(e) => update({ sourceLang: e.target.value })}>
            <option value="auto">Auto-detect</option>
            {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <span className="arrow" aria-hidden="true">→</span>
        <label className="lang-box">
          <small>Subtitles in</small>
          <select value={settings.targetLang} onChange={(e) => update({ targetLang: e.target.value })}>
            {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>

      <section className="hero">
        <div className={`orb ${status.running ? 'on' : ''}`}>
          <span className="ring" /><span className="ring" /><span className="ring" />
          <button
            className="go"
            onClick={props.onToggle}
            disabled={props.busy || (!status.running && needsModel)}
            aria-label={status.running ? 'Stop translation' : 'Start translation'}
          >
            {status.running ? <StopGlyph /> : <PlayGlyph />}
          </button>
        </div>
        <div className="status" role="status">
          <b>{headline}</b>
          <span>{note}</span>
        </div>
        <Wave level={props.level} active={status.running && !loading} />
      </section>

      {needsModel && speechModel && (
        <div className="banner">
          <span>The <b>{speechModel.name}</b> speech model is needed ({speechModel.sizeMb} MB).</span>
          {props.downloads[speechKey]?.status === 'progress'
            ? <DownloadProgress event={props.downloads[speechKey]} />
            : <button className="btn primary small" onClick={() => props.onDownload(speechKey)}>Download</button>}
        </div>
      )}

      {settings.outputMode === 'transcript'
        ? <LiveTranscript sessionId={status.sessionId} running={status.running} onError={props.onError} notify={props.notify} />
        : <OverlayPreview settings={settings} last={lastSub} />}

      <section className="card flush">
        <Option title="Speak translation aloud" note={`Hear each sentence as a voice-over in ${langName(settings.targetLang)}.`}>
          <Switch label="Speak translation aloud" checked={settings.speakTranslation} onChange={(speakTranslation) => update({ speakTranslation })} />
        </Option>
        {settings.speakTranslation && (
          <Option title="Mute original audio" note="Silence the video while the voice-over plays.">
            <Switch label="Mute original audio" checked={settings.muteOriginal} onChange={(muteOriginal) => update({ muteOriginal })} />
          </Option>
        )}
      </section>

      <details className="card flush adv" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
        <summary>Audio &amp; engine <Icon name="chevron" small /></summary>
        <div className="adv-body">
          <label className="field">
            <span>Audio source</span>
            <select value={settings.audioSource} onChange={(e) => update({ audioSource: e.target.value })}>
              {props.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="row">
            <label className="field grow">
              <span>Speech model</span>
              <select value={settings.whisperModel} onChange={(e) => update({ whisperModel: e.target.value })}>
                {models?.whisper.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.installed ? '' : ' (not downloaded)'}</option>
                ))}
              </select>
            </label>
            <div className="field grow">
              <span>Speed</span>
              <Segmented
                label="Speed"
                value={settings.mode}
                options={[['fast', 'Fast'], ['accurate', 'Accurate']] as const}
                onChange={(mode) => update({ mode })}
              />
            </div>
          </div>
          {settings.targetLang === 'en' && (
            <div className="row between">
              <span className="check">Translate to English in one step (faster)</span>
              <Switch label="Translate to English in one step" checked={settings.englishViaWhisper} onChange={(englishViaWhisper) => update({ englishViaWhisper })} />
            </div>
          )}
          <p className="hint">
            {usesOneStep
              ? 'English subtitles work out of the box, no translation model needed.'
              : 'Needs a translation model for each spoken language (see Models).'}
          </p>
        </div>
      </details>
    </>
  )
}
