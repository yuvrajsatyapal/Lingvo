import { useEffect, useState } from 'react'
import { api, errorText, type Settings, type Translation } from './api'
import { LANGUAGE_OPTIONS, langName } from './langs'

type Phase = 'idle' | 'translating' | 'recording'

/** Translate typed text or a spoken clip on demand, and read or hear the result. */
export function Translator(props: { settings: Settings; onError: (message: string | null) => void }) {
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

  return (
    <>
      <section className="card">
        <div className="pair">
          <label>
            <span>From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <button className="swap" onClick={swap} aria-label="Swap languages">⇄</button>
          <label>
            <span>To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {LANGUAGE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
        </div>
        <label>
          <span>Text to translate</span>
          <textarea
            rows={4}
            value={text}
            placeholder={`Type or paste ${langName(from)} text, or record speech`}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="wide primary" onClick={translate} disabled={phase !== 'idle' || !text.trim()}>
            {phase === 'translating' ? 'Translating…' : 'Translate text'}
          </button>
          <button
            className={`wide ${phase === 'recording' ? 'recording' : ''}`}
            onClick={toggleRecording}
            disabled={phase === 'translating'}
          >
            {phase === 'recording' ? 'Stop and translate' : 'Record speech'}
          </button>
        </div>
        <p className="hint">
          {phase === 'recording'
            ? 'Recording from your microphone. The spoken language is detected automatically.'
            : 'Recording uses your microphone and detects the language for you.'}
        </p>
      </section>

      <section className="card">
        <div className="row between">
          <h2>{langName(to)}</h2>
          <label className="check auto-speak">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />
            <span>Speak automatically</span>
          </label>
        </div>
        {result
          ? <p className="result">{result.translated}</p>
          : <p className="muted empty">The translation appears here, as text you can also listen to.</p>}
        <div className="row">
          <button className="wide" disabled={!result} onClick={() => result && api.speak(result.translated, to).catch((e) => onError(errorText(e)))}>
            Listen
          </button>
          <button className="wide" disabled={!result} onClick={() => api.stopSpeaking().catch(() => undefined)}>
            Stop
          </button>
          <button
            className="wide"
            disabled={!result}
            onClick={() => result && navigator.clipboard.writeText(result.translated).catch(() => onError('Could not copy the text.'))}
          >
            Copy
          </button>
        </div>
      </section>
    </>
  )
}
