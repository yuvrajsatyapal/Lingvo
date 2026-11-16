// Offline soundtrack synth. All timings come from src/beats.ts so music and picture stay locked.
// Warm pad, deep bass, light kick/snare, low pluck melody. No bells, chimes or high blips.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BEATS, DURATION, EVENTS, FPS, FRAMES_PER_BAR, FRAMES_PER_BEAT, translationWordFrames } from '../src/beats'

const SR = 44100
const LEN = Math.ceil((DURATION / FPS) * SR)
const L = new Float32Array(LEN)
const R = new Float32Array(LEN)
const sendL = new Float32Array(LEN) // reverb/delay send
const sendR = new Float32Array(LEN)

const sec = (frames: number) => frames / FPS
const at = (frames: number) => Math.round(sec(frames) * SR)
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12)

let seed = 1337
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function add(i: number, v: number, pan = 0, send = 0) {
  if (i < 0 || i >= LEN) return
  const gl = Math.cos((pan + 1) * Math.PI / 4)
  const gr = Math.sin((pan + 1) * Math.PI / 4)
  L[i] += v * gl; R[i] += v * gr
  sendL[i] += v * gl * send; sendR[i] += v * gr * send
}

const lpCoef = (fc: number) => 1 - Math.exp((-2 * Math.PI * fc) / SR)

// Section gates (frame-based).
const inRange = (f: number, a: number, b: number) => f >= a && f < b
const AIR = { from: EVENTS.air, to: EVENTS.hit }
const fullBand = (f: number) => inRange(f, BEATS.problem.from, AIR.from) || inRange(f, AIR.to, BEATS.end.from)

// ---------- Chords (one per bar, D major: Dmaj7 · Bm7 · Gmaj7 · A) ----------
const PROG = [
  { root: 38, notes: [50, 54, 57, 61, 64] },
  { root: 35, notes: [47, 50, 54, 57, 62] },
  { root: 31, notes: [50, 55, 59, 62, 66] },
  { root: 33, notes: [49, 52, 57, 61, 64] },
]
// Offset so the hit (bar 9) and the end card (bar 13) both land on Dmaj7.
const chordAt = (bar: number) => PROG[(bar + 3) % 4]
const BARS = Math.ceil(DURATION / FRAMES_PER_BAR)

// ---------- Pad ----------
function pad() {
  for (let bar = 0; bar < BARS; bar++) {
    const ch = chordAt(bar)
    const start = at(bar * FRAMES_PER_BAR)
    const end = at((bar + 1) * FRAMES_PER_BAR)
    const tail = Math.round(0.9 * SR)
    const atk = Math.round(0.45 * SR)
    ch.notes.forEach((m, ni) => {
      const f0 = mtof(m)
      const detunes = [-0.006, 0, 0.0065]
      const phases = detunes.map(() => rand())
      let z1 = 0, z2 = 0
      const pan = (ni / (ch.notes.length - 1)) * 1.2 - 0.6
      for (let i = start; i < end + tail && i < LEN; i++) {
        const frame = (i / SR) * FPS
        let s = 0
        detunes.forEach((d, k) => {
          phases[k] += (f0 * (1 + d)) / SR
          phases[k] -= Math.floor(phases[k])
          const p = phases[k]
          s += (2 * p - 1) * 0.5 + (1 - 4 * Math.abs(p - 0.5)) * 0.5
        })
        // Cutoff: closed in the intro, opens for the band, dips during the air bar.
        let fc = 1500
        if (frame < BEATS.problem.from) fc = 350 + (frame / BEATS.problem.from) * 900
        else if (inRange(frame, AIR.from, AIR.to)) fc = 1500 - ((frame - AIR.from) / (AIR.to - AIR.from)) * 1050
        else if (frame >= BEATS.end.from) fc = 1300 - ((frame - BEATS.end.from) / (DURATION - BEATS.end.from)) * 800
        const a = lpCoef(fc)
        z1 += a * (s - z1); z2 += a * (z1 - z2)
        const n = i - start
        let env = Math.min(1, n / atk)
        if (i >= end) env *= Math.max(0, 1 - (i - end) / tail)
        add(i, z2 * env * 0.05, pan, 0.55)
      }
    })
  }
}

// ---------- Bass ----------
function bass() {
  for (let f = 0; f < DURATION; f += FRAMES_PER_BEAT * 2) {
    const playing = fullBand(f) || f === BEATS.end.from
    if (!playing) continue
    const bar = Math.floor(f / FRAMES_PER_BAR)
    const freq = mtof(chordAt(bar).root)
    const start = at(f)
    const dur = f === BEATS.end.from ? 3.2 : 0.95
    const n = Math.round(dur * SR)
    let ph = 0
    for (let k = 0; k < n; k++) {
      ph += freq / SR
      const t = k / SR
      const env = Math.min(1, t / 0.006) * (f === BEATS.end.from ? Math.exp(-t * 1.1) : 0.55 + 0.45 * Math.exp(-t * 6)) * Math.min(1, (n - k) / (0.06 * SR))
      const s = Math.tanh((Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph)) * 1.6)
      add(start + k, s * env * 0.2, 0, 0.05)
    }
  }
}

// ---------- Drums ----------
function kick(i0: number, gain: number) {
  let ph = 0
  for (let k = 0; k < 0.45 * SR; k++) {
    const t = k / SR
    const f = 45 + 85 * Math.exp(-t * 28)
    ph += f / SR
    add(i0 + k, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5) * gain, 0, 0.02)
  }
}

function snare(i0: number, gain: number) {
  let lp1 = 0, lp2 = 0
  const a1 = lpCoef(2600), a2 = lpCoef(700)
  let ph = 0
  for (let k = 0; k < 0.25 * SR; k++) {
    const t = k / SR
    const n = rand() * 2 - 1
    lp1 += a1 * (n - lp1); lp2 += a2 * (n - lp2)
    ph += 185 / SR
    const s = (lp1 - lp2) * Math.exp(-t * 22) + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 30) * 0.6
    add(i0 + k, s * gain, 0.1, 0.25)
  }
}

function drums() {
  for (let f = BEATS.problem.from; f < BEATS.end.from; f += FRAMES_PER_BEAT) {
    if (!fullBand(f)) continue
    const beatInBar = Math.round((f % FRAMES_PER_BAR) / FRAMES_PER_BEAT)
    if (beatInBar === 0 || beatInBar === 2) kick(at(f), f < BEATS.action.from ? 0.32 : 0.42)
    if ((beatInBar === 1 || beatInBar === 3) && f >= BEATS.action.from) snare(at(f), 0.12)
  }
}

// ---------- Pluck (Karplus-Strong, low and warm) ----------
function pluck(i0: number, midi: number, gain: number, pan = 0, decay = 0.996) {
  const freq = mtof(midi)
  const N = Math.round(SR / freq)
  const buf = new Float32Array(N)
  let lp = 0
  for (let k = 0; k < N; k++) { const n = rand() * 2 - 1; lp += 0.5 * (n - lp); buf[k] = lp }
  let idx = 0
  for (let k = 0; k < 1.6 * SR; k++) {
    const next = (idx + 1) % N
    const v = buf[idx]
    buf[idx] = decay * 0.5 * (buf[idx] + buf[next])
    idx = next
    add(i0 + k, v * gain * Math.min(1, k / 40), pan, 0.45)
  }
}

function melody() {
  // 8th-note positions per bar and the chord tone (index into chord notes, +12) for each.
  const pattern: [number, number][] = [[0, 2], [3, 4], [5, 3], [6, 1]]
  const eighth = FRAMES_PER_BEAT / 2
  for (let bar = 0; bar < BARS; bar++) {
    const ch = chordAt(bar)
    for (const [step, tone] of pattern) {
      const f = bar * FRAMES_PER_BAR + step * eighth
      if (f < BEATS.subtitles.from || !fullBand(f)) continue
      const m = Math.min(ch.notes[tone] + 12, 74)
      pluck(at(f), m, 0.16, step % 2 ? 0.35 : -0.35)
    }
  }
}

// ---------- Effects tied to on-screen events ----------
function whoosh(centerFrame: number, gain: number, down = false) {
  const len = Math.round(0.7 * SR)
  const i0 = at(centerFrame) - Math.round(0.45 * SR)
  let z1 = 0, z2 = 0
  for (let k = 0; k < len; k++) {
    const t = k / len
    const shape = Math.sin(Math.PI * t) ** 2
    const fc = down ? 2200 - 1900 * t : 300 + 2200 * Math.sin(Math.PI * t)
    const a = lpCoef(fc)
    const n = rand() * 2 - 1
    z1 += a * (n - z1); z2 += a * (z1 - z2)
    add(i0 + k, z2 * shape * gain, -0.6 + 1.2 * t, 0.3)
  }
}

function click(frame: number) {
  const i0 = at(frame)
  let lp = 0
  const a = lpCoef(1800)
  let ph = 0
  for (let k = 0; k < 0.08 * SR; k++) {
    const t = k / SR
    const n = rand() * 2 - 1
    lp += a * (n - lp)
    ph += (240 - 900 * t) / SR
    add(i0 + k, (lp * 0.6 + Math.sin(2 * Math.PI * ph)) * Math.exp(-t * 60) * 0.32, 0.25, 0.1)
  }
}

function tap(frame: number, gain: number) {
  const i0 = at(frame)
  let lp = 0
  const a = lpCoef(1300)
  for (let k = 0; k < 0.04 * SR; k++) {
    const t = k / SR
    lp += a * ((rand() * 2 - 1) - lp)
    add(i0 + k, lp * Math.exp(-t * 110) * gain, -0.2 + rand() * 0.4, 0.05)
  }
}

function riser(from: number, to: number) {
  const i0 = at(from), i1 = at(to)
  let z1 = 0, z2 = 0
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / (i1 - i0)
    const a = lpCoef(180 + 1500 * t * t)
    z1 += a * ((rand() * 2 - 1) - z1); z2 += a * (z1 - z2)
    add(i, z2 * t * t * 0.55, 0, 0.2)
  }
}

function impact(frame: number) {
  const i0 = at(frame)
  kick(i0, 0.7)
  let ph = 0
  let lp = 0
  const a = lpCoef(900)
  for (let k = 0; k < 1.8 * SR; k++) {
    const t = k / SR
    ph += (36 + 30 * Math.exp(-t * 5)) / SR
    lp += a * ((rand() * 2 - 1) - lp)
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) * 0.5
    const body = lp * Math.exp(-t * 9) * 0.35
    add(i0 + k, boom + body, 0, 0.35)
  }
}

// ---------- Space: stereo delay + small Schroeder reverb on the send bus ----------
function space() {
  const dly = Math.round(0.375 * SR)
  const dl = new Float32Array(LEN), dr = new Float32Array(LEN)
  let lpL = 0, lpR = 0
  const a = lpCoef(2200)
  for (let i = 0; i < LEN; i++) {
    const fbL = i >= dly ? dr[i - dly] : 0
    const fbR = i >= dly ? dl[i - dly] : 0
    lpL += a * (sendL[i] * 0.5 + fbL * 0.32 - lpL)
    lpR += a * (sendR[i] * 0.5 + fbR * 0.32 - lpR)
    dl[i] = lpL; dr[i] = lpR
  }
  const combs = [1557, 1617, 1491, 1422]
  const verb = (input: Float32Array, spread: number) => {
    const out = new Float32Array(LEN)
    for (const c of combs) {
      const n = c + spread
      const buf = new Float32Array(n)
      let idx = 0, damp = 0
      for (let i = 0; i < LEN; i++) {
        const y = buf[idx]
        damp = y * 0.6 + damp * 0.4
        buf[idx] = input[i] + damp * 0.82
        out[i] += y * 0.25
        idx = (idx + 1) % n
      }
    }
    for (const ap of [556 + spread, 441 + spread]) {
      const buf = new Float32Array(ap)
      let idx = 0
      for (let i = 0; i < LEN; i++) {
        const b = buf[idx]
        const y = -out[i] + b
        buf[idx] = out[i] + b * 0.5
        out[i] = y
        idx = (idx + 1) % ap
      }
    }
    return out
  }
  const vl = verb(sendL, 0), vr = verb(sendR, 23)
  for (let i = 0; i < LEN; i++) {
    L[i] += dl[i] * 0.45 + vl[i] * 0.22
    R[i] += dr[i] * 0.45 + vr[i] * 0.22
  }
}

// ---------- Build ----------
pad()
bass()
drums()
melody()
riser(BEATS.problem.from - 40, BEATS.problem.from)
for (const f of EVENTS.transitions) {
  if (f === EVENTS.air) whoosh(f, 0.28, true)
  else if (f !== BEATS.problem.from) whoosh(f, 0.32)
}
click(EVENTS.click)
translationWordFrames().forEach((f) => tap(f, 0.14))
riser(EVENTS.hit - 30, EVENTS.hit)
impact(EVENTS.hit)
EVENTS.trustRows.forEach((f, i) => pluck(at(f), [57, 62, 66][i], 0.22, (i - 1) * 0.4, 0.993))
space()

// Fade in the first moments and fade out over the end card.
for (let i = 0; i < LEN; i++) {
  const f = (i / SR) * FPS
  let g = Math.min(1, f / 8)
  if (f > BEATS.end.from + 40) g *= Math.max(0, 1 - (f - BEATS.end.from - 40) / (DURATION - BEATS.end.from - 44))
  L[i] *= g; R[i] *= g
}

// Loudness: normalise to about -14 dBFS RMS, soft-limit, keep peaks under -1 dBFS.
const rms = () => { let s = 0; for (let i = 0; i < LEN; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * LEN)) }
const peak = () => { let p = 0; for (let i = 0; i < LEN; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p }
const target = 10 ** (-14 / 20)
const ceiling = 10 ** (-1 / 20)
for (let pass = 0; pass < 4; pass++) {
  const g = target / rms()
  for (let i = 0; i < LEN; i++) {
    L[i] = Math.tanh(L[i] * g * 1.1) / 1.1
    R[i] = Math.tanh(R[i] * g * 1.1) / 1.1
  }
}
const p = peak()
if (p > ceiling) for (let i = 0; i < LEN; i++) { L[i] *= ceiling / p; R[i] *= ceiling / p }

const db = (x: number) => (20 * Math.log10(x)).toFixed(1)
console.log(`rms ${db(rms())} dBFS, peak ${db(peak())} dBFS`)

// 16-bit stereo WAV.
const data = Buffer.alloc(LEN * 4)
for (let i = 0; i < LEN; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../public/music.wav'), Buffer.concat([header, data]))
console.log('wrote public/music.wav')
