import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect } from 'react'

export interface OverlayStyle {
  fontSize: number
  textColor: string
  bgColor: string
  bgOpacity: number
  maxLines: number
  showOriginal: boolean
}

export interface Settings {
  sourceLang: string
  targetLang: string
  audioSource: string
  whisperModel: string
  mode: 'fast' | 'accurate'
  englishViaWhisper: boolean
  saveHistory: boolean
  outputMode: 'subtitles' | 'transcript'
  speakTranslation: boolean
  muteOriginal: boolean
  overlay: OverlayStyle
}

export type EngineState = 'idle' | 'loading' | 'listening' | 'recognizing' | 'translating' | 'error'

export interface Status {
  state: EngineState
  message: string | null
  detectedLang: string | null
  running: boolean
  sessionId: number | null
}

export interface Subtitle {
  id: number
  text: string
  original: string | null
  sourceLang: string | null
  isFinal: boolean
  latencyMs: number
}

export interface AudioSource {
  id: string
  name: string
  isSystem: boolean
}

export interface WhisperModel {
  id: string
  name: string
  sizeMb: number
  note: string
  supportsTranslate: boolean
  recommended: boolean
  installed: boolean
}

export interface TranslationPackage {
  fromCode: string
  toCode: string
  fromName: string
  toName: string
  installed: boolean
}

export interface ModelList {
  whisper: WhisperModel[]
  translation: TranslationPackage[]
  translationError: string | null
}

export interface DownloadEvent {
  key: string
  done: number
  total: number | null
  status: 'progress' | 'done' | 'error'
  error: string | null
}

export interface HistoryEntry {
  id: number
  createdAt: string
  sourceLang: string | null
  targetLang: string
  original: string | null
  translated: string
  sessionId: number | null
}

export interface SessionSummary {
  id: number
  startedAt: string
  endedAt: string
  lineCount: number
  sourceLang: string | null
  targetLang: string
  title: string
  preview: string
}

export interface Translation {
  original: string
  sourceLang: string | null
  translated: string
}

export const api = {
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<void>('save_settings', { settings }),
  listAudioSources: () => invoke<AudioSource[]>('list_audio_sources'),
  getStatus: () => invoke<Status>('get_status'),
  start: () => invoke<void>('start'),
  stop: () => invoke<void>('stop'),
  listModels: (refresh: boolean) => invoke<ModelList>('list_models', { refresh }),
  downloadModel: (key: string) => invoke<void>('download_model', { key }),
  deleteModel: (key: string) => invoke<void>('delete_model', { key }),
  getHistory: (limit: number, session: number | null = null) =>
    invoke<HistoryEntry[]>('get_history', { limit, session }),
  listSessions: (limit: number) => invoke<SessionSummary[]>('list_sessions', { limit }),
  deleteSession: (session: number) => invoke<void>('delete_session', { session }),
  exportTranscript: (session: number | null) => invoke<string>('export_transcript', { session }),
  revealFile: (path: string) => invoke<void>('reveal_file', { path }),
  translateText: (text: string, from: string, to: string) =>
    invoke<Translation>('translate_text', { text, from, to }),
  recordStart: () => invoke<void>('record_start'),
  recordStop: (to: string) => invoke<Translation>('record_stop', { to }),
  speak: (text: string, lang: string) => invoke<void>('speak', { text, lang }),
  stopSpeaking: () => invoke<void>('stop_speaking'),
  clearHistory: () => invoke<void>('clear_history'),
  setOverlayVisible: (visible: boolean) => invoke<void>('set_overlay_visible', { visible }),
  getOverlayState: () => invoke<[boolean, boolean]>('get_overlay_state'),
  setOverlayEdit: (edit: boolean) => invoke<void>('set_overlay_edit', { edit }),
}

/** Subscribes to a backend event for the lifetime of the component. */
export function useBackendEvent<T>(name: string, handler: (payload: T) => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<T>(name, (e) => handler(e.payload)).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
}

export function errorText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.'
}
