import { AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { BEATS, EVENTS, LINE } from './beats'
import { Cursor } from './Cursor'
import facts from './facts.generated.json'
import { Headline } from './Headline'
import { LingvoWindow } from './LingvoWindow'
import { camera, clamp, ease, pop, shake, type Key } from './motion'
import { Player } from './Player'
import { T } from './theme'

const CENTER = { x: 960, y: 680 }
const WIN = { x: 1300, y: 222, s: 1.1 }
const BUTTON = { x: WIN.x + 220 * WIN.s, y: WIN.y + 280 * WIN.s }

const CAM: Key[] = [
  { f: 90, x: 960, y: 640, s: 0.9 },
  { f: 205, x: 960, y: 760, s: 1.12 },
  { f: 232, x: 1080, y: 640, s: 0.97 },
  { f: 262, x: 1450, y: 560, s: 1.3 },
  { f: 326, x: 1440, y: 575, s: 1.37 },
  { f: 352, x: 960, y: 640, s: 0.98 },
  { f: 470, x: 700, y: 770, s: 1.08 },
  { f: 630, x: 720, y: 750, s: 1.02 },
]

function wordsUpTo(text: string, start: number, every: number, frame: number) {
  const words = text.split(' ')
  const n = Math.max(0, Math.min(words.length, Math.floor((frame - start) / every) + 1))
  return words.slice(0, n).join(' ')
}

function World() {
  const frame = useCurrentFrame()
  const cam = camera(frame, CAM)
  const hit = shake(frame, EVENTS.hit, 8, 12)

  const playerX = ease(frame, EVENTS.windowIn, EVENTS.windowIn + 26, 410, 110)
  const playerY = 330
  const w = pop(frame, EVENTS.windowIn, 15, 120)

  const showSub = frame >= EVENTS.originalStart
  const final = frame >= EVENTS.finalize
  const subtitle = showSub
    ? {
        original: final ? LINE.original : wordsUpTo(LINE.original, EVENTS.originalStart, EVENTS.wordEvery, frame),
        text: final ? LINE.translation : frame >= EVENTS.translationStart ? wordsUpTo(LINE.translation, EVENTS.translationStart, EVENTS.wordEvery, frame) : '',
        final,
      }
    : null

  const enter = ease(frame, BEATS.problem.from - 4, BEATS.problem.from + 14)
  const dim = Math.max(ease(frame, BEATS.payoff.from, BEATS.payoff.from + 14), 0)
  const leave = ease(frame, BEATS.trust.from - 2, BEATS.trust.from + 14)

  if (frame < BEATS.problem.from - 4 || frame > BEATS.trust.from + 16) return null

  return (
    <AbsoluteFill style={{
      opacity: enter * (1 - leave), filter: `blur(${(1 - enter) * 14 + dim * 7 + leave * 10}px)`,
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transformOrigin: '0 0',
        transform: `translate(${CENTER.x - cam.x * cam.s + hit.x}px, ${CENTER.y - cam.y * cam.s + hit.y}px) scale(${cam.s})`,
      }}>
        <div style={{ position: 'absolute', left: playerX, top: playerY }}>
          <Player subtitle={subtitle} ccStruck={ease(frame, 130, 150)} />
        </div>
        {frame >= EVENTS.windowIn && (
          <div style={{
            position: 'absolute', left: WIN.x, top: WIN.y, transformOrigin: '0 0', opacity: Math.min(1, w * 1.5),
            transform: `perspective(1600px) translateX(${(1 - w) * 520}px) rotateY(${(1 - w) * -30}deg) scale(${WIN.s})`,
            filter: `blur(${Math.max(0, 1 - w) * 12}px)`,
          }}>
            <LingvoWindow preview={subtitle ? { original: subtitle.original, text: subtitle.text, opacity: 1 } : null} />
          </div>
        )}
        <Cursor
          from={{ x: 1760, y: 960 }} to={{ x: BUTTON.x - 4, y: BUTTON.y - 2 }}
          appear={EVENTS.cursorIn} arrive={EVENTS.click - 6} click={EVENTS.click} leave={EVENTS.click + 30}
        />
      </div>
      <AbsoluteFill style={{ background: '#000', opacity: dim * 0.93 }} />
    </AbsoluteFill>
  )
}

function Open() {
  const frame = useCurrentFrame()
  if (frame > BEATS.open.to + 8) return null
  const icon = pop(frame, 4, 12, 150)
  const word = pop(frame, 12, 14, 150)
  const tag = pop(frame, 30, 16, 120)
  const exit = ease(frame, BEATS.open.to - 10, BEATS.open.to + 6)
  return (
    <AbsoluteFill style={{
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34, fontFamily: T.font,
      transform: `translateY(${-90 * exit}px) scale(${1 + frame * 0.0012})`, opacity: 1 - exit, filter: `blur(${exit * 14}px)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <Img src={staticFile('icon.png')} style={{ width: 176, height: 176, transform: `scale(${0.5 + 0.5 * icon}) rotate(${(1 - icon) * -12}deg)`, opacity: Math.min(1, icon * 2) }} />
        <div style={{ fontSize: 160, fontWeight: 700, letterSpacing: '-0.045em', color: T.text, transform: `translateX(${(1 - word) * 60}px)`, opacity: Math.min(1, word * 1.5) }}>
          Lingvo
        </div>
      </div>
      <Tagline progress={tag} />
    </AbsoluteFill>
  )
}

function Tagline({ progress }: { progress: number }) {
  return (
    <div style={{ fontSize: 50, fontWeight: 500, color: T.muted, letterSpacing: '-0.02em', opacity: Math.min(1, progress * 1.5), transform: `translateY(${(1 - progress) * 24}px)` }}>
      Live subtitles for <span style={{ color: T.accent }}>anything</span> your Mac plays.
    </div>
  )
}

function Payoff() {
  const frame = useCurrentFrame()
  if (frame < EVENTS.hit - 2 || frame > BEATS.payoff.to + 2) return null
  const n = pop(frame, EVENTS.hit, 11, 220)
  const s = shake(frame, EVENTS.hit, 16, 14)
  const cap = pop(frame, EVENTS.hit + 10, 16, 140)
  const chips = [pop(frame, EVENTS.hit + 22, 14, 160), pop(frame, EVENTS.hit + 30, 14, 160)]
  const src = ease(frame, EVENTS.hit + 40, EVENTS.hit + 52)
  const exit = ease(frame, BEATS.payoff.to - 9, BEATS.payoff.to)

  const chip = (p: number, label: string, value: string) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 14, padding: '18px 28px', borderRadius: 18, background: T.s1, border: `1px solid ${T.line}`,
      opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 30}px)`,
    }}>
      <span style={{ fontSize: 30, color: T.muted }}>{label}</span>
      <b style={{ fontSize: 40, color: T.text, fontVariantNumeric: 'tabular-nums' }}>~{value} s</b>
    </div>
  )

  return (
    <AbsoluteFill style={{
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', fontFamily: T.font, paddingTop: 90,
      opacity: 1 - exit, filter: `blur(${exit * 12}px)`, transform: `translateY(${-30 * exit}px)`,
    }}>
      <div style={{
        fontSize: 330, fontWeight: 800, letterSpacing: '-0.06em', color: T.accent, lineHeight: 1,
        transform: `translate(${s.x}px, ${s.y}px) scale(${2.1 - 1.1 * n})`, opacity: interpolate(frame, [EVENTS.hit, EVENTS.hit + 3], [0, 1], clamp),
        fontVariantNumeric: 'tabular-nums',
      }}>
        ~{facts.endToLine}<span style={{ fontSize: '0.45em', letterSpacing: '-0.02em', marginLeft: '0.12em' }}>s</span>
      </div>
      <div style={{ fontSize: 44, fontWeight: 600, color: T.text, marginTop: 18, opacity: Math.min(1, cap * 1.5), transform: `translateY(${(1 - cap) * 20}px)` }}>
        from the end of speech to a finished subtitle
      </div>
      <div style={{ display: 'flex', gap: 22, marginTop: 44 }}>
        {chip(chips[0], 'Recognition', facts.recognition)}
        {chip(chips[1], 'Translation', facts.translation)}
      </div>
      <div style={{ marginTop: 36, fontSize: 24, color: T.muted, letterSpacing: '0.02em', opacity: src }}>
        Measured on {facts.conditions}
      </div>
    </AbsoluteFill>
  )
}

function Trust() {
  const frame = useCurrentFrame()
  if (frame < BEATS.trust.from || frame > BEATS.trust.to + 2) return null
  const exit = ease(frame, BEATS.trust.to - 9, BEATS.trust.to)
  const line = pop(frame, EVENTS.trustRows[2] + 18, 16, 120)
  return (
    <AbsoluteFill style={{
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', fontFamily: T.font, paddingTop: 100, gap: 54,
      opacity: 1 - exit, filter: `blur(${exit * 12}px)`, transform: `translateY(${-30 * exit}px)`,
    }}>
      <div style={{ display: 'flex', gap: 36 }}>
        {facts.promise.map((label, i) => {
          const p = pop(frame, EVENTS.trustRows[i], 12, 170)
          const tick = interpolate(frame, [EVENTS.trustRows[i] + 4, EVENTS.trustRows[i] + 14], [0, 1], clamp)
          return (
            <div key={label} style={{
              width: 440, padding: '44px 36px', borderRadius: 26, background: T.s1, border: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 26, opacity: Math.min(1, p * 1.5),
              transform: `translateY(${(1 - p) * 60}px) scale(${0.92 + 0.08 * p})`,
            }}>
              <svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9.5" />
                <path d="M7.5 12.5l3 3 6-6.5" strokeDasharray={16} strokeDashoffset={16 * (1 - tick)} />
              </svg>
              <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: '-0.03em', color: T.text }}>{label}</div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 40, color: T.muted, fontWeight: 500, opacity: Math.min(1, line * 1.5), transform: `translateY(${(1 - line) * 20}px)` }}>
        {facts.neverUploaded}.
      </div>
    </AbsoluteFill>
  )
}

function End() {
  const frame = useCurrentFrame()
  if (frame < BEATS.end.from) return null
  const icon = pop(frame, BEATS.end.from + 4, 12, 150)
  const word = pop(frame, BEATS.end.from + 10, 14, 150)
  const tag = pop(frame, BEATS.end.from + 22, 16, 120)
  const drift = 1 + (frame - BEATS.end.from) * 0.0006
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34, fontFamily: T.font, transform: `scale(${drift})` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <Img src={staticFile('icon.png')} style={{ width: 176, height: 176, transform: `scale(${0.5 + 0.5 * icon})`, opacity: Math.min(1, icon * 2) }} />
        <div style={{ fontSize: 160, fontWeight: 700, letterSpacing: '-0.045em', color: T.text, opacity: Math.min(1, word * 1.5), transform: `translateX(${(1 - word) * 60}px)` }}>
          Lingvo
        </div>
      </div>
      <Tagline progress={tag} />
    </AbsoluteFill>
  )
}

export function LingvoPromo() {
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Audio src={staticFile('music.wav')} />
      <World />
      <Open />
      <Payoff />
      <Trust />
      <End />
      <Headline text="No subtitles in your language." accent="your" from={BEATS.problem.from + 6} to={BEATS.problem.to} />
      <Headline text="Just press Start." accent="Start" from={BEATS.action.from} to={BEATS.action.to} />
      <Headline text="Subtitles as they speak." accent="speak" from={BEATS.subtitles.from} to={BEATS.subtitles.to} />
      <Headline text="About a second behind." accent="second" from={BEATS.payoff.from} to={BEATS.payoff.to} />
      <Headline text="Nothing leaves your Mac." accent="Mac" from={BEATS.trust.from} to={BEATS.trust.to} />
    </AbsoluteFill>
  )
}
