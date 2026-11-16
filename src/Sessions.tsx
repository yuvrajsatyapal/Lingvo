import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errorText, useBackendEvent, type HistoryEntry, type SessionSummary, type Settings } from './api'
import { langName } from './langs'
import { Empty, Icon, Segmented, Switch, clock, dayLabel, formatDuration } from './ui'

type View = 'original' | 'translation' | 'both'

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: ReactNode[] = []
  let at = 0
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) parts.push(text.slice(at, i))
    parts.push(<mark key={i}>{text.slice(i, i + q.length)}</mark>)
    at = i + q.length
  }
  parts.push(text.slice(at))
  return parts
}

const duration = (s: SessionSummary) => formatDuration(new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime())

function LangPair({ s }: { s: SessionSummary }) {
  return <span className="lang-pair">{langName(s.sourceLang)} <b>→</b> {langName(s.targetLang)}</span>
}

function SessionCard(props: { s: SessionSummary; live: boolean; query: string; onOpen: () => void }) {
  const { s, live, query } = props
  return (
    <button className={`sess ${live ? 'live' : ''}`} onClick={props.onOpen}>
      <div className="sess-head">
        <span className="sess-title"><Highlight text={s.title} query={query} /></span>
        <span className="sess-time">{live ? <span className="live-tag"><i />Live</span> : clock(s.startedAt)}</span>
      </div>
      <p className="sess-preview"><Highlight text={s.preview} query={query} /></p>
      <div className="meta">
        <LangPair s={s} />
        <span>{s.lineCount} lines</span>
        <span>{live ? 'in progress' : duration(s)}</span>
      </div>
    </button>
  )
}

function SessionDetail(props: {
  s: SessionSummary
  live: boolean
  onBack: () => void
  onDeleted: () => void
  onError: (m: string | null) => void
  notify: (m: string) => void
}) {
  const { s } = props
  const [lines, setLines] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('both')
  const [saved, setSaved] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(() => {
    api.getHistory(100_000, s.id).then((h) => setLines([...(h ?? [])].reverse())).catch(() => setLines([]))
  }, [s.id])
  useEffect(load, [load])
  useBackendEvent<{ isFinal: boolean }>('subtitle', (e) => { if (props.live && e.isFinal) load() })

  const q = query.trim()
  const shown = lines.filter((l) => !q || `${l.original ?? ''} ${l.translated}`.toLowerCase().includes(q.toLowerCase()))

  const copy = () => {
    const text = lines.map((l) => (l.original ? `${l.original}\n→ ${l.translated}` : l.translated)).join('\n\n')
    navigator.clipboard.writeText(text).then(() => props.notify('Copied to clipboard')).catch(() => props.onError('Could not copy the transcript.'))
  }
  const save = async () => {
    props.onError(null)
    try {
      setSaved(await api.exportTranscript(s.id))
      props.notify('Saved to Documents/Lingvo')
    } catch (e) {
      props.onError(errorText(e))
    }
  }
  const remove = async () => {
    try {
      await api.deleteSession(s.id)
      props.notify('Session deleted')
      props.onDeleted()
    } catch (e) {
      props.onError(errorText(e))
      setConfirming(false)
    }
  }

  return (
    <>
      <div><button className="ghost back" onClick={props.onBack}><Icon name="back" small />Sessions</button></div>
      <div className="heading">
        <div className="meta">{props.live && <span className="live-tag"><i />Live now</span>}<span>{dayLabel(s.startedAt)}, {clock(s.startedAt)}</span></div>
        <h1 className="title-sm">{s.title}</h1>
      </div>
      <div className="stats">
        <div className="stat"><b>{s.lineCount}</b><span>Lines</span></div>
        <div className="stat"><b>{props.live ? '…' : duration(s)}</b><span>Duration</span></div>
        <div className="stat"><b>{(s.sourceLang ?? '??').toUpperCase()} → {s.targetLang.toUpperCase()}</b><span>Languages</span></div>
      </div>
      <div className="row">
        <button className="btn grow small" onClick={copy}><Icon name="copy" small />Copy</button>
        <button className="btn grow small" onClick={save}><Icon name="file" small />Save text</button>
        <button className="btn small danger" onClick={() => setConfirming(true)} aria-label="Delete session"><Icon name="trash" small /></button>
      </div>
      {saved && <button className="link small-text" onClick={() => api.revealFile(saved).catch(() => undefined)}>Show in Finder</button>}
      <label className="search">
        <Icon name="search" small />
        <input type="search" placeholder="Search this session" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Segmented
        label="Show"
        value={view}
        options={[['both', 'Both'], ['translation', 'Translation'], ['original', 'Original']] as const}
        onChange={setView}
      />
      <div>
        {shown.length === 0 && <Empty title={q ? 'No matches' : 'No lines yet'} />}
        {shown.map((l) => (
          <div key={l.id} className="entry">
            <span className="time">{clock(l.createdAt)}</span>
            <div>
              {view !== 'translation' && l.original && <p className="orig"><Highlight text={l.original} query={q} /></p>}
              {view !== 'original' && <p className="trans"><Highlight text={l.translated} query={q} /></p>}
            </div>
          </div>
        ))}
      </div>
      {confirming && (
        <Confirm
          title="Delete this session?"
          body={`“${s.title}” and its ${s.lineCount} lines will be removed from this device. This can’t be undone.`}
          action="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </>
  )
}

export function Confirm(props: { title: string; body: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal" role="alertdialog" aria-modal="true" aria-label={props.title}>
      <div className="modal-box">
        <h3>{props.title}</h3>
        <p>{props.body}</p>
        <div className="row">
          <button className="btn grow" onClick={props.onCancel}>Cancel</button>
          <button className="btn grow danger" onClick={props.onConfirm}>{props.action}</button>
        </div>
      </div>
    </div>
  )
}

export function Sessions(props: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  liveSessionId: number | null
  goLive: () => void
  onError: (m: string | null) => void
  notify: (m: string) => void
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [todayOnly, setTodayOnly] = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(() => {
    api.listSessions(500).then((s) => setSessions(s ?? [])).catch(() => setSessions([]))
  }, [])
  useEffect(load, [load])
  useBackendEvent<{ isFinal: boolean }>('subtitle', (e) => { if (e.isFinal) load() })
  useBackendEvent<{ running: boolean }>('status', load)

  const open = sessions?.find((s) => s.id === openId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (sessions ?? []).filter((s) => {
      if (todayOnly && dayLabel(s.startedAt) !== 'Today') return false
      return !q || `${s.title} ${s.preview}`.toLowerCase().includes(q)
    })
  }, [sessions, query, todayOnly])

  if (open) {
    return (
      <SessionDetail
        s={open}
        live={open.id === props.liveSessionId}
        onBack={() => setOpenId(null)}
        onDeleted={() => { setOpenId(null); load() }}
        onError={props.onError}
        notify={props.notify}
      />
    )
  }

  const groups: [string, SessionSummary[]][] = []
  for (const s of filtered) {
    const day = dayLabel(s.startedAt)
    const last = groups[groups.length - 1]
    if (last && last[0] === day) last[1].push(s)
    else groups.push([day, [s]])
  }

  return (
    <>
      <div className="heading"><h1>Sessions</h1><p>Every run, saved as text. Audio is never stored.</p></div>

      <section className="card flush">
        <div className="option">
          <div><b>Keep translated text on this device</b><span className="note">Turn off to stop saving new sessions.</span></div>
          <Switch label="Keep translated text" checked={props.settings.saveHistory} onChange={(saveHistory) => props.update({ saveHistory })} />
        </div>
      </section>

      {sessions === null && <p className="muted">Loading…</p>}
      {sessions?.length === 0 && (
        <Empty title="No sessions yet" action={<button className="btn primary" onClick={props.goLive}>Go to Live</button>}>
          Press start on the Live tab and play a video. Each run is saved here so you can reopen it later.
        </Empty>
      )}

      {!!sessions?.length && (
        <>
          <label className="search">
            <Icon name="search" small />
            <input type="search" placeholder="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="chips">
            <button className={`chip ${!todayOnly ? 'on' : ''}`} onClick={() => setTodayOnly(false)}>All</button>
            <button className={`chip ${todayOnly ? 'on' : ''}`} onClick={() => setTodayOnly(true)}>Today</button>
          </div>
          {filtered.length === 0 && <Empty title="No matches">Nothing mentions “{query}”.</Empty>}
          {groups.map(([day, items]) => (
            <div key={day} className="day-group">
              <h2 className="label">{day}</h2>
              {items.map((s) => (
                <SessionCard key={s.id} s={s} live={s.id === props.liveSessionId} query={query.trim()} onOpen={() => setOpenId(s.id)} />
              ))}
            </div>
          ))}
          <button className="btn small danger center" onClick={() => setClearing(true)}>Clear all history</button>
        </>
      )}

      {clearing && (
        <Confirm
          title="Clear all history?"
          body={`All ${sessions?.length ?? 0} sessions will be removed from this device. This can’t be undone.`}
          action="Clear all"
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            setClearing(false)
            api.clearHistory().then(() => { props.notify('History cleared'); load() }).catch((e) => props.onError(errorText(e)))
          }}
        />
      )}
    </>
  )
}
