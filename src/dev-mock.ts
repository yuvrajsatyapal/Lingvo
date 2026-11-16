// Lets the UI run in a plain browser (`pnpm dev`) with sample data, for layout work only.
const settings = {
  sourceLang: 'auto', targetLang: 'en', audioSource: 'system', whisperModel: 'small', mode: 'fast',
  englishViaWhisper: true, saveHistory: true, outputMode: 'transcript', speakTranslation: true, muteOriginal: true,
  overlay: { fontSize: 30, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0.6, maxLines: 2, showOriginal: true },
}

const now = Date.now()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
const sessions = [
  { id: 3, startedAt: iso(3 * 3600e3), endedAt: iso(2.4 * 3600e3), lineCount: 142, sourceLang: 'fr', targetLang: 'en', title: 'Bonjour tout le monde, bienvenue', preview: 'You must always preheat the oven.' },
  { id: 2, startedAt: iso(27 * 3600e3), endedAt: iso(26 * 3600e3), lineCount: 318, sourceLang: 'ja', targetLang: 'en', title: '今日はとても寒いですね', preview: 'Let’s go to the station together.' },
  { id: 1, startedAt: iso(100 * 3600e3), endedAt: iso(99 * 3600e3), lineCount: 2, sourceLang: 'es', targetLang: 'en', title: '¿Dónde está la estación de tren?', preview: 'Today we are going to talk about the history of Spain.' },
]

const responses: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_settings: () => settings,
  save_settings: (a) => Object.assign(settings, a.settings),
  get_status: () => ({ state: 'listening', message: null, detectedLang: 'es', running: true, sessionId: 1 }),
  translate_text: (a) => ({ original: a.text, sourceLang: a.from, translated: 'Where is the train station?' }),
  list_audio_sources: () => [
    { id: 'system', name: 'System audio (everything playing)', isSystem: true },
    { id: 'input:mic', name: 'MacBook Air Microphone', isSystem: false },
  ],
  list_models: () => ({
    whisper: [
      { id: 'tiny', name: 'Tiny', sizeMb: 75, note: 'Fastest, but often wrong', supportsTranslate: true, recommended: false, installed: false },
      { id: 'base', name: 'Base', sizeMb: 142, note: 'Fast, but translations are often wrong', supportsTranslate: true, recommended: false, installed: true },
      { id: 'small', name: 'Small', sizeMb: 181, note: 'Accurate and still keeps up with live speech', supportsTranslate: true, recommended: true, installed: true },
    ],
    translation: [
      { fromCode: 'es', toCode: 'en', fromName: 'Spanish', toName: 'English', installed: true },
      { fromCode: 'fr', toCode: 'en', fromName: 'French', toName: 'English', installed: false },
    ],
    translationError: null,
  }),
  get_history: () => [
    { id: 1, createdAt: '2026-11-15T17:00:00Z', sourceLang: 'es', targetLang: 'en', original: '¿Dónde está la estación de tren?', translated: 'Where is the train station?', sessionId: 1 },
    { id: 2, createdAt: '2026-11-15T17:00:05Z', sourceLang: 'es', targetLang: 'en', original: 'Hoy vamos a hablar de la historia de España.', translated: 'Today we are going to talk about the history of Spain.', sessionId: 1 },
  ],
  list_sessions: () => [...sessions],
  delete_session: (a) => { const i = sessions.findIndex((x) => x.id === a.session); if (i >= 0) sessions.splice(i, 1); return null },
  clear_history: () => { sessions.length = 0; return null },
  get_overlay_state: () => [true, new URLSearchParams(location.search).has('edit')],
}

export function installMock() {
  const label = new URLSearchParams(location.search).get('window') ?? 'main'
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label } },
      transformCallback: () => 0,
      invoke: async (cmd: string, args: Record<string, unknown>) => responses[cmd]?.(args) ?? null,
    },
  })
}
