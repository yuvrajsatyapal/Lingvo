// Single source of timing for picture (Remotion) and sound (scripts/synth.ts).
// 120 BPM at 30 fps: one beat = 15 frames, one bar = 60 frames.

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
export const DURATION = 900

export const BPM = 120
export const FRAMES_PER_BEAT = (FPS * 60) / BPM
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * 4

export const BEATS = {
  open: { from: 0, to: 90 },
  problem: { from: 90, to: 210 },
  action: { from: 210, to: 330 },
  subtitles: { from: 330, to: 480 },
  payoff: { from: 480, to: 630 },
  trust: { from: 630, to: 780 },
  end: { from: 780, to: 900 },
} as const

export type BeatName = keyof typeof BEATS

export const EVENTS = {
  windowIn: 216,
  cursorIn: 236,
  click: 270,
  originalStart: 342,
  translationStart: 362,
  wordEvery: 5,
  finalize: 432,
  // One bar of air between the payoff headline and the hit.
  air: 480,
  hit: 540,
  trustRows: [660, 672, 684],
  resolve: 780,
  transitions: [90, 210, 330, 480, 630, 780],
} as const

export const LINE = {
  original: 'Hoy vamos a hablar de la historia de España.',
  translation: 'Today we are going to talk about the history of Spain.',
}

export const translationWordFrames = (): number[] =>
  LINE.translation.split(' ').map((_, i) => EVENTS.translationStart + i * EVENTS.wordEvery)
