import { useCurrentFrame } from 'remotion'
import { clamp, ease, pop } from './motion'
import { T } from './theme'
import { interpolate } from 'remotion'

// Headline lands word by word; the accent word gets the yellow underline.
export function Headline(props: { text: string; accent: string; from: number; to: number; size?: number }) {
  const frame = useCurrentFrame()
  const { from, to } = props
  if (frame < from - 1 || frame > to + 1) return null
  const words = props.text.split(' ')
  const exit = ease(frame, to - 9, to, 0, 1)

  return (
    <div
      style={{
        position: 'absolute', top: 64, left: 0, right: 0, display: 'flex', justifyContent: 'center',
        gap: '0.26em', fontFamily: T.font, fontSize: props.size ?? 84, fontWeight: 700, letterSpacing: '-0.035em',
        color: T.text, transform: `translateY(${-40 * exit}px)`, opacity: 1 - exit, filter: `blur(${exit * 10}px)`,
        zIndex: 20,
      }}
    >
      {words.map((w, i) => {
        const at = from + 3 + i * 4
        const p = pop(frame, at, 13, 170)
        const isAccent = w.replace(/[.,]/g, '') === props.accent
        const bare = w.replace(/[.,]$/, '')
        const punct = w.slice(bare.length)
        const underline = interpolate(frame, [at + 6, at + 16], [0, 1], clamp)
        return (
          <span
            key={i}
            style={{
              display: 'inline-block', opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 46}px)`,
              filter: `blur(${(1 - Math.min(1, p)) * 8}px)`,
            }}
          >
            {isAccent ? (
              <span style={{ position: 'relative', color: T.accent }}>
                {bare}
                <span style={{
                  position: 'absolute', left: 0, bottom: '-0.04em', height: '0.07em', width: `${underline * 100}%`,
                  background: T.accent, borderRadius: 4,
                }} />
              </span>
            ) : bare}
            {punct}
          </span>
        )
      })}
    </div>
  )
}
