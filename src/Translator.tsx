import { useEffect, useState } from 'react'
import { api, errorText, type Settings, type Translation } from './api'
import { LANGUAGE_OPTIONS, langName } from './langs'
import { Icon, Switch } from './ui'

type Phase = 'idle' | 'translating' | 'recording'
const MAX_CHARS = 2000

/** Translate typed text or a spoken clip on demand, and read or hear the result. */
export function Translator(props: { settings: Settings; onError: (message: string | null) => void; notify: (m: string) => void }) {
  const { onError } = props
  const [from, setFrom] = useState('es')
  const [to, setTo] = useState(props.settings.targetLang)
  const [text, setText] = useState('')
  const [result, setResult] = useState<Translation | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [autoSpeak, setAutoSpeak] = useState(false)

  useEffect(() => () => { api.stopSpeaking().catch(() => undefined) }, [])

  const finish = (translation: Translation) => {
    setResult(translation)
    if (autoSpeak) api.speak(translation.translated, to).catch((e) => onError(errorText(e)))
  }

  const translate = async () => {
    if (!text.trim()) return
    onError(null)
    setPhase('translating')
    try {
      finish(await api.translateText(text.trim(), from, to))
    } catch (e) {
      onError(errorText(e))
    } finally {
      setPhase('idle')
    }
  }

  const toggleRecording = async () => {
    onError(null)
    try {
      if (phase !== 'recording') {
        await api.recordStart()
        setPhase('recording')
        return
      }
      setPhase('translating')
      const translation = await api.recordStop(to)
      setText(translation.original)
      if (translation.sourceLang) setFrom(translation.sourceLang === 'no' ? 'nb' : translation.sourceLang)
      finish(translation)
    } catch (e) {
      onError(errorText(e))
    } finally {
      setPhase((p) => (p === 'translating' ? 'idle' : p))
    }
  }

  const swap = () => {
    setFrom(to)
    setTo(from)
    if (result) setText(result.translated)
    setResult(null)
  }

  const listen = () => result && api.speak(result.translated, to).catch((e) => onError(errorText(e)))
  const copy = () => result && navigator.clipboard.writeText(result.translated)
    .then(() => props.notify('Copied'))
    .catch(() => onError('Could not copy the text.'))

  return (
    <>
      <div className="heading"><h1>Translate</h1><p>Type, paste, or speak. Works offline.</p></div>

      <div className="tbox">
        <div className="tbox-head">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
            {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <span className="hint">{text.length} / {MAX_CHARS}</span>
        </div>
        <textarea
          rows={4}
          maxLength={MAX_CHARS}
          value={text}
          placeholder={`Type or paste ${langName(from)} text`}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row between">
          <button
            className={`icon-btn ${phase === 'recording' ? 'rec' : ''}`}
            onClick={toggleRecording}
            disabled={phase === 'translating'}
            aria-label={phase === 'recording' ? 'Stop and translate' : 'Record speech'}
          >
            <Icon name="mic" />
          </button>
          {phase === 'recording'
            ? <span className="hint">Recording… tap to stop and translate</span>
            : <button className="ghost" disabled={!text} onClick={() => { setText(''); setResult(null) }}>Clear</button>}
        </div>
      </div>

      <div className="swap-wrap">
        <button className="swap-btn" onClick={swap} aria-label="Swap languages"><Icon name="swap" small /></button>
      </div>

      <div className="tbox out">
        <div className="tbox-head">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
            {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <span className="row">
            <span className="hint">Auto-speak</span>
            <Switch label="Speak automatically" checked={autoSpeak} onChange={setAutoSpeak} />
          </span>
        </div>
        <p className={`result ${result ? '' : 'muted'}`} aria-live="polite">
          {phase === 'translating'
            ? <>Translating <span className="dots"><i /><i /><i /></span></>
            : result ? result.translated : 'The translation appears here.'}
        </p>
        <div className="row">
          <button className="icon-btn" disabled={!result} onClick={listen} aria-label="Listen"><Icon name="speaker" /></button>
          <button className="icon-btn" disabled={!result} onClick={() => api.stopSpeaking().catch(() => undefined)} aria-label="Stop listening">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
          </button>
          <button className="icon-btn" disabled={!result} onClick={copy} aria-label="Copy"><Icon name="copy" /></button>
        </div>
      </div>

      <button className="btn primary" onClick={translate} disabled={phase !== 'idle' || !text.trim()}>
        {phase === 'translating' ? 'Translating…' : 'Translate'}
      </button>
    </>
  )
}
