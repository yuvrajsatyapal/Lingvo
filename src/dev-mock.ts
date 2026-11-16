// Lets the UI run in a plain browser (`pnpm dev`) with sample data, for layout work only.
const settings = {
  sourceLang: 'auto', targetLang: 'en', audioSource: 'system', whisperModel: 'base', mode: 'fast',
  englishViaWhisper: true, saveHistory: true, outputMode: 'transcript', speakTranslation: true, muteOriginal: true,
  overlay: { fontSize: 30, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0.6, maxLines: 2, showOriginal: true },
}

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
      { id: 'tiny', name: 'Tiny', sizeMb: 75, note: 'Fastest, least accurate', supportsTranslate: true, installed: false },
      { id: 'base', name: 'Base', sizeMb: 142, note: 'Good balance for most computers', supportsTranslate: true, installed: true },
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
