// Mirrors the :root tokens in ../src/styles.css (the app's own design system).
export const T = {
  bg: '#000',
  s1: '#0d0d0d',
  s2: '#151515',
  s3: '#1f1f1f',
  line: '#262626',
  line2: '#333',
  text: '#f5f5f2',
  muted: '#8e8e8a',
  accent: '#ffd666',
  accentSoft: 'rgba(255, 214, 102, 0.12)',
  accentLine: 'rgba(255, 214, 102, 0.45)',
  radius: 16,
  font: "-apple-system, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
}

// Paths copied from ../src/ui.tsx so icons match the app exactly.
export const ICON = {
  live: 'M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2',
  translate: 'M4 5h9M8.5 3v2M6 5c.5 4 3 7 6.5 8.5M12 5c-.5 3-3 6.5-7 8.5M13 21l4-10 4 10M14.5 17.5h5',
  subtitles: 'M7 11h4M13 11h4M7 15h2M12 15h5M6 5h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V8a3 3 0 013-3z',
  sessions: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  models: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
}
