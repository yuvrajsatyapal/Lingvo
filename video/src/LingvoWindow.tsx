import type { CSSProperties } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { EVENTS } from './beats'
import { clamp, pop } from './motion'
import { ICON, T } from './theme'

// Recreation of the Live tab (src/Live.tsx + src/Control.tsx) at the app's native 440 × 760 size.
export const WIN_W = 440
export const WIN_H = 760

const Icon = ({ d, size = 22, color = 'currentColor' }: { d: string; size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

function Mark() {
  const bar = (w: string, self: CSSProperties['alignSelf'] = 'flex-start'): CSSProperties => ({
    display: 'block', height: 3, borderRadius: 2, background: T.accent, width: w, alignSelf: self,
  })
  return (
    <div style={{ width: 28, height: 28, borderRadius: 9, border: `1.5px solid ${T.accent}`, padding: '6px 5px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
      <i style={bar('55%')} /><i style={bar('100%')} /><i style={bar('75%', 'center')} />
    </div>
  )
}

function Wave({ on }: { on: boolean }) {
  const frame = useCurrentFrame()
  const bars = 32
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 34 }}>
      {Array.from({ length: bars }, (_, i) => {
        const edge = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2)
        const n = (Math.sin(frame * 0.55 + i * 1.7) + Math.sin(frame * 0.31 + i * 0.6) + 2) / 4
        const h = on ? 4 + n * 30 * (1 - edge * 0.65) : 4
        return <i key={i} style={{ display: 'block', width: 3, height: h, borderRadius: 2, background: on ? T.accent : '#3a3a3a' }} />
      })}
    </div>
  )
}

export function LingvoWindow(props: { preview: { original: string; text: string; opacity: number } | null }) {
  const frame = useCurrentFrame()
  const on = frame >= EVENTS.click + 2
  const press = frame >= EVENTS.click - 2 && frame < EVENTS.click + 4 ? 0.95 : 1
  const flip = pop(frame, EVENTS.click + 2, 12, 200)

  const segBtn = (active: boolean): CSSProperties => ({
    flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 13, fontWeight: 500, textAlign: 'center',
    color: active ? T.text : T.muted, background: active ? T.s3 : 'transparent', boxShadow: active ? `inset 0 0 0 1px ${T.line2}` : 'none',
  })
  const langBox: CSSProperties = { background: T.s1, border: `1px solid ${T.line}`, borderRadius: 14, padding: '9px 12px' }
  const small: CSSProperties = { display: 'block', color: T.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }

  return (
    <div style={{
      width: WIN_W, height: WIN_H, background: T.bg, borderRadius: 22, border: `1px solid ${T.line2}`, overflow: 'hidden',
      position: 'relative', fontFamily: T.font, color: T.text, fontSize: 14, boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
    }}>
      <div style={{ height: 30, display: 'flex', gap: 8, alignItems: 'center', padding: '0 14px' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: '#3a3a3a' }} />)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>
          <Mark /> Lingvo
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, fontSize: 12,
          color: on ? T.text : T.muted, background: T.s1, border: `1px solid ${on ? T.accentLine : T.line}`,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? T.accent : T.muted, opacity: on ? 0.65 + 0.35 * Math.cos(frame / 6) : 1 }} />
          {on ? 'Listening · Spanish' : 'Idle'}
        </span>
      </div>

      <div style={{ padding: '10px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', background: T.s1, border: `1px solid ${T.line}`, borderRadius: 12, padding: 3, gap: 2 }}>
          <div style={segBtn(true)}>Floating subtitles</div>
          <div style={segBtn(false)}>Transcript</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
          <div style={langBox}><small style={small}>Spoken</small><b style={{ fontSize: 16 }}>Auto-detect</b></div>
          <span style={{ color: T.accent, fontSize: 18 }}>→</span>
          <div style={langBox}><small style={small}>Subtitles in</small><b style={{ fontSize: 16 }}>English</b></div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '14px 0 4px' }}>
          <div style={{ position: 'relative', width: 132, height: 132, display: 'grid', placeItems: 'center' }}>
            {on && [0, 24, 48].map((delay) => {
              const t = ((frame - EVENTS.click - delay) % 72 + 72) % 72 / 72
              const live = frame - EVENTS.click - delay >= 0
              return live ? (
                <span key={delay} style={{
                  position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${T.accentLine}`,
                  opacity: 0.7 * (1 - t), transform: `scale(${0.78 + 0.47 * t})`,
                }} />
              ) : null
            })}
            <div style={{
              width: 96, height: 96, borderRadius: '50%', display: 'grid', placeItems: 'center', transform: `scale(${press})`,
              background: on ? '#000' : T.accent, color: on ? T.accent : '#000', boxShadow: on ? `inset 0 0 0 2px ${T.accent}` : 'none',
            }}>
              <svg width={34} height={34} viewBox="0 0 24 24" fill="currentColor" style={{ transform: `scale(${on ? flip : 1})` }}>
                {on ? <rect x="6" y="6" width="12" height="12" rx="2.5" /> : <path d="M8 5.5v13a1 1 0 001.5.86l10-6.5a1 1 0 000-1.72l-10-6.5A1 1 0 008 5.5z" />}
              </svg>
            </div>
          </div>
          <div style={{ textAlign: 'center', minHeight: 42 }}>
            <b style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{on ? 'Hearing Spanish' : 'Ready when you are'}</b>
            <span style={{ color: T.muted, fontSize: 12.5 }}>
              {on ? 'Subtitles appear a second or two after speech.' : 'Captures audio your computer plays. Nothing leaves this device.'}
            </span>
          </div>
          <Wave on={on} />
        </div>

        <div style={{ background: T.s1, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em', color: T.muted, fontWeight: 600 }}>On your screen</p>
            <span style={{ color: T.muted, fontSize: 12.5 }}>
              Press <kbd style={{ background: T.s3, border: `1px solid ${T.line2}`, borderRadius: 6, padding: '1px 6px', color: T.text, fontSize: 12, fontFamily: T.font }}>⌘⇧L</kbd> to hide
            </span>
          </div>
          <div style={{ height: 96, borderRadius: 12, background: '#111', border: `1px solid ${T.line}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 8 }}>
            {props.preview && (
              <div style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '3px 9px', textAlign: 'center', opacity: interpolate(props.preview.opacity, [0, 1], [0, 1], clamp) }}>
                <div style={{ fontSize: 8.5, color: '#fff', opacity: 0.8 }}>{props.preview.original}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{props.preview.text}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        borderTop: `1px solid ${T.line}`, background: 'rgba(8,8,8,0.96)', padding: '6px 6px 10px',
      }}>
        {([['live', 'Live'], ['translate', 'Translate'], ['subtitles', 'Subtitles'], ['sessions', 'Sessions'], ['models', 'Models']] as const).map(([k, label]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '7px 0', fontSize: 11, fontWeight: 500, color: k === 'live' ? T.accent : T.muted, position: 'relative' }}>
            {k === 'live' && <span style={{ position: 'absolute', top: -7, width: 22, height: 2, borderRadius: 2, background: T.accent }} />}
            <Icon d={ICON[k]} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
