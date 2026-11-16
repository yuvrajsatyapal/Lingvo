import { Easing, interpolate, spring } from 'remotion'
import { FPS } from './beats'

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const pop = (frame: number, at: number, damping = 14, stiffness = 140) =>
  spring({ frame: frame - at, fps: FPS, config: { damping, stiffness, mass: 0.9 } })

export const ease = (frame: number, from: number, to: number, a = 0, b = 1, fn = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [from, to], [a, b], { ...clamp, easing: fn })

export type Cam = { x: number; y: number; s: number }
export type Key = Cam & { f: number }

// Camera keys are always moving toward the next one, so the shot never sits dead still.
export function camera(frame: number, keys: Key[]): Cam {
  if (frame <= keys[0].f) return keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (frame <= b.f) {
      const t = Easing.inOut(Easing.cubic)((frame - a.f) / (b.f - a.f))
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s + (b.s - a.s) * t }
    }
  }
  return keys[keys.length - 1]
}

// One soft, decaying shake. Deterministic, no jitter.
export function shake(frame: number, at: number, amp = 14, len = 14) {
  const t = frame - at
  if (t < 0 || t > len) return { x: 0, y: 0 }
  const decay = 1 - t / len
  return { x: Math.sin(t * 1.9) * amp * decay * decay, y: Math.cos(t * 2.3) * amp * 0.5 * decay * decay }
}
