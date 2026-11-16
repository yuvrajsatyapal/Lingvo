export const LANGUAGES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', cs: 'Czech', sk: 'Slovak',
  hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', el: 'Greek', tr: 'Turkish', ar: 'Arabic',
  he: 'Hebrew', fa: 'Persian', hi: 'Hindi', bn: 'Bengali', ur: 'Urdu', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay',
  tl: 'Tagalog', sv: 'Swedish', da: 'Danish', nb: 'Norwegian', fi: 'Finnish', et: 'Estonian',
  lv: 'Latvian', lt: 'Lithuanian', sl: 'Slovenian', sq: 'Albanian', ca: 'Catalan',
  gl: 'Galician', eu: 'Basque', ga: 'Irish', sw: 'Swahili', az: 'Azerbaijani', eo: 'Esperanto',
}

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]))

export function langName(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  const normalized = code === 'no' ? 'nb' : code
  return LANGUAGES[normalized] ?? code.toUpperCase()
}
