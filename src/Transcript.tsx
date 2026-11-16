import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText, useBackendEvent, type HistoryEntry, type Subtitle } from './api'

/** Saves stored lines to a text file in Documents/Lingvo and offers to show it. */
export function SaveTranscript(props: {
  sessionId: number | null
  label: string
  onError: (message: string | null) => void
}) {
  const [saved, setSaved] = useState<string | null>(null)
  const save = async () => {
    props.onError(null)
    try {
      setSaved(await api.exportTranscript(props.sessionId))
    } catch (e) {
      props.onError(errorText(e))
    }
  }
  return (
    <div className="row between">
      <button className="small" onClick={save}>{props.label}</button>
      {saved && (
        <button className="link small-text" onClick={() => api.revealFile(saved).catch(() => undefined)}>
          Saved. Show in Finder
        </button>
      )}
    </div>
  )
}

/** The running list of original and translated lines for the current session. */
export function LiveTranscript(props: {
  sessionId: number | null
  running: boolean
  onError: (message: string | null) => void
}) {
  const { sessionId } = props
  const [lines, setLines] = useState<HistoryEntry[]>([])
  const [pending, setPending] = useState<Subtitle | null>(null)
  const end = useRef<HTMLDivElement>(null)

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
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines, pending])

  const copy = () => {
    const text = lines.map((l) => (l.original ? `${l.original}\n→ ${l.translated}` : l.translated)).join('\n\n')
    navigator.clipboard.writeText(text).catch(() => props.onError('Could not copy the transcript.'))
  }

  return (
    <section className="card">
      <div className="row between">
        <h2>Transcript</h2>
        <button className="small" disabled={!lines.length} onClick={copy}>Copy</button>
      </div>
      <div className="transcript" aria-live="polite">
        {!lines.length && !pending && (
          <p className="muted empty">
            {props.running ? 'Listening. Lines appear here as people speak.' : 'Press Start and play a video.'}
          </p>
        )}
        {lines.map((l) => (
          <div key={l.id} className="line">
            {l.original && <p className="muted">{l.original}</p>}
            <p>{l.translated}</p>
          </div>
        ))}
        {pending && props.running && <div className="line line-pending"><p>{pending.text}</p></div>}
        <div ref={end} />
      </div>
      {!!lines.length && <SaveTranscript sessionId={sessionId} label="Save as a text file" onError={props.onError} />}
    </section>
  )
}
